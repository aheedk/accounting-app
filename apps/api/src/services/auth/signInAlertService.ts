import { createHash } from 'node:crypto';
import geoip from 'geoip-lite';
import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import { sendEmail, newSignInAlertEmail } from '../notifications/emailService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// A new-device/new-location sign-in alert. Spec:
// docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
//
// "Device" here means a browser+IP combination this login hasn't signed in
// from before, tracked in user_devices (separate from refresh_tokens/sessions,
// which get revoked — a device should stay "known" across sign-outs).

/** "Chrome on Windows" from a user-agent string. Same logic as the web's
 * lib/browserName.ts describeBrowser — kept as its own small copy here rather
 * than a shared package for one 10-line function used on each side for a
 * slightly different purpose (an email body vs. a sessions table). */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\/|Opera/.test(userAgent) ? 'Opera'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : 'A browser';
  const system = /Windows/.test(userAgent) ? 'Windows'
    : /iPhone|iPad/.test(userAgent) ? 'iPhone or iPad'
    : /Android/.test(userAgent) ? 'Android'
    : /Mac OS X/.test(userAgent) ? 'Mac'
    : /Linux/.test(userAgent) ? 'Linux'
    : null;
  return system ? `${browser} on ${system}` : browser;
}

/** City-level, approximate is fine. 'Unknown location' for a private/local IP
 * (every dev/test sign-in) or one geoip-lite's bundled data doesn't cover. */
function describeLocation(ipAddress: string): string {
  const geo = geoip.lookup(ipAddress);
  if (!geo) return 'Unknown location';
  return [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'Unknown location';
}

// IPv4: the /24 (first three octets) — a home/office's public IP can change
// its last octet between sign-ins without that being a new "location" worth
// alerting on. IPv6 and anything else: the whole address, unprefixed.
function ipPrefix(ipAddress: string): string {
  const parts = ipAddress.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : ipAddress;
}

export function deviceFingerprint(userAgent: string, ipAddress: string): string {
  return createHash('sha256').update(`${userAgent}|${ipPrefix(ipAddress)}`).digest('hex');
}

/**
 * Called after a successful sign-in. Does nothing for the very first sign-in
 * ever on a login (`isFirstSignIn` — the device they just set their password
 * on is implicitly trusted); otherwise looks up the fingerprint and, if it's
 * not already known, emails the alert and remembers it.
 */
export async function noteSignIn(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  user: { email: string },
  meta: { user_agent: string; ip_address: string },
  isFirstSignIn: boolean,
): Promise<void> {
  if (isFirstSignIn || !meta.user_agent || !meta.ip_address) return;
  const fingerprint = deviceFingerprint(meta.user_agent, meta.ip_address);

  const existing = await trx.selectFrom('user_devices').select('id')
    .where('user_id', '=', ctx.user_id).where('device_fingerprint', '=', fingerprint).executeTakeFirst();
  if (existing) {
    await trx.updateTable('user_devices').set({ last_seen: sql`now()` })
      .where('id', '=', existing.id).execute();
    return;
  }

  await trx.insertInto('user_devices').values({
    user_id: ctx.user_id,
    device_fingerprint: fingerprint,
    device_label: describeDevice(meta.user_agent),
    ip_address: meta.ip_address,
  }).execute();

  const email_sent = await sendEmail(newSignInAlertEmail({
    to: user.email,
    timestamp: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    device: describeDevice(meta.user_agent),
    location: describeLocation(meta.ip_address),
    ipAddress: meta.ip_address,
    forgotPasswordUrl: `${config.APP_PUBLIC_URL}/forgot-password`,
  }));
  await auditRecord(trx, ctx, {
    action: AUDIT.AUTH_NEW_DEVICE_ALERT, entity_type: 'user', entity_id: ctx.user_id, before: null,
    after: { device: describeDevice(meta.user_agent), email_sent },
  });
}

/** For the Security section's device list — not built yet; exported for that follow-up. */
export async function knownDevices(db: Kysely<DB>, user_id: string) {
  return db.selectFrom('user_devices').selectAll().where('user_id', '=', user_id).orderBy('last_seen', 'desc').execute();
}
