import { Resend } from 'resend';
import { config } from '../../config.js';

// Sends the two account-setup emails (invitation, password reset). Spec:
// docs/specs/2026-11-15-user-invitations-and-signin-design.md
//
// Without RESEND_API_KEY set, an email is logged instead of sent — not
// refused, not faked. Every other part of the invitation/reset flow (the
// token, its expiry, acceptance) works the same either way, so local dev and
// the test suite need no key; the one thing that needs one is real delivery.

export type Email = {
  to: string;
  subject: string;
  html: string;
  /** The accept/reset link, logged (never sent) so it's clickable in dev without a Resend key.
   * Omitted for a purely informational email with no link to click. */
  devPreviewUrl?: string;
};

let client: Resend | null = null;
function resendClient(): Resend | null {
  if (!config.RESEND_API_KEY) return null;
  client ??= new Resend(config.RESEND_API_KEY);
  return client;
}

/** Whether it actually went out — callers that let the admin act on it (resend) surface this; self-service ones (forgot password) deliberately don't, so the response can't reveal whether an email exists. */
export async function sendEmail(email: Email): Promise<boolean> {
  const resend = resendClient();
  if (!resend) {
    console.log(`[email] RESEND_API_KEY is not set — logging instead of sending. to=${email.to} subject="${email.subject}"${email.devPreviewUrl ? ` link=${email.devPreviewUrl}` : ''}`);
    return false;
  }
  try {
    const { error } = await resend.emails.send({ from: config.EMAIL_FROM, to: email.to, subject: email.subject, html: email.html });
    if (error) { console.error(`[email] Resend refused the message to ${email.to}:`, error); return false; }
    return true;
  } catch (e: unknown) {
    // A person's account is created, or their reset link is issued, whether or
    // not the email actually reaches them — "Resend invitation" covers a
    // delivery failure, so this never fails the request that triggered it.
    console.error(`[email] sending to ${email.to} failed:`, e);
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

// One centered, table-based card: table layout is what survives Outlook's
// rendering engine, where flexbox/grid in an email body is unreliable.
// `button` is omitted for a purely informational email (deactivated,
// reactivated, social-account-linked) — nothing to click, nothing to do.
function layout(opts: { heading: string; bodyHtml: string; button?: { label: string; url: string }; fineprint?: string }): string {
  const buttonRow = opts.button ? `
            <tr>
              <td style="padding:24px 32px 8px 32px; text-align:center;">
                <a href="${opts.button.url}" style="display:inline-block; background-color:#18181b; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 28px; border-radius:8px;">${opts.button.label}</a>
              </td>
            </tr>` : '';
  const fineprintRow = opts.fineprint ? `
            <tr>
              <td style="padding:8px 32px 32px 32px; text-align:center;">
                <p style="margin:0; font-size:12px; color:#a1a1aa;">${opts.fineprint}</p>
              </td>
            </tr>` : '';
  return `<!doctype html>
<html>
  <body style="margin:0; padding:32px 16px; background-color:#f4f4f5; font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background-color:#ffffff; border-radius:12px; border:1px solid #e4e4e7;">
            <tr>
              <td style="padding:32px 32px 8px 32px; text-align:center;">
                <span style="font-size:20px; font-weight:700; color:#18181b;">Accmatica</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px ${opts.button || opts.fineprint ? '0' : '32'}px 32px;">
                <h1 style="margin:0 0 16px 0; font-size:20px; color:#18181b;">${opts.heading}</h1>
                <div style="font-size:14px; line-height:1.6; color:#3f3f46;">${opts.bodyHtml}</div>
              </td>
            </tr>${buttonRow}${fineprintRow}
          </table>
          <p style="max-width:480px; margin:16px auto 0 auto; font-size:12px; color:#a1a1aa; text-align:center;">
            If you didn't expect this email, you can safely ignore it.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function invitationEmail(input: { to: string; firmName: string; adminName: string; acceptUrl: string }): Email {
  const firmName = escapeHtml(input.firmName);
  const adminName = escapeHtml(input.adminName);
  return {
    to: input.to,
    subject: `You've been invited to join ${input.firmName}`,
    html: layout({
      heading: `You've been invited to join ${firmName} on Accmatica`,
      bodyHtml: `<p>${adminName} has invited you to access accounting data on Accmatica. Click below to set up your account.</p>`,
      button: { label: 'Set up your account', url: input.acceptUrl },
      fineprint: 'This invitation expires in 30 days.',
    }),
    devPreviewUrl: input.acceptUrl,
  };
}

export function passwordResetEmail(input: { to: string; resetUrl: string }): Email {
  return {
    to: input.to,
    subject: 'Reset your password for Accmatica',
    html: layout({
      heading: 'Reset your password',
      bodyHtml: '<p>We received a request to reset the password for this account. Click below to choose a new one.</p>',
      button: { label: 'Reset password', url: input.resetUrl },
      fineprint: 'This link expires in 1 hour.',
    }),
    devPreviewUrl: input.resetUrl,
  };
}

export function primaryAdminTransferEmail(input: { to: string; firmName: string; currentAdminName: string; acceptUrl: string }): Email {
  const firmName = escapeHtml(input.firmName);
  const currentAdminName = escapeHtml(input.currentAdminName);
  return {
    to: input.to,
    subject: "You've been invited to become Primary Admin",
    html: layout({
      heading: `Become the Primary Admin of ${firmName}`,
      bodyHtml: `<p>${currentAdminName} has invited you to become the Primary Admin of ${firmName}. As Primary Admin, you'll have full control over the firm, all clients, team management, and billing.</p>`,
      button: { label: 'Review the invitation', url: input.acceptUrl },
      fineprint: 'This invitation expires in 7 days.',
    }),
    devPreviewUrl: input.acceptUrl,
  };
}

// ── The new email-lifecycle rules below. Spec:
// docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md

/** Informational: no link needed, but a reset link is included as a safety
 * measure in case the change wasn't the account holder's doing. */
export function passwordChangedEmail(input: { to: string; appName?: string; forgotPasswordUrl: string }): Email {
  const appName = input.appName ?? 'Accmatica';
  return {
    to: input.to,
    subject: 'Your password was changed',
    html: layout({
      heading: 'Your password was changed',
      bodyHtml: `
        <p>Your password for ${escapeHtml(appName)} was recently changed.</p>
        <p>If you made this change, no further action is needed.</p>
        <p>If you didn't change your password, secure your account immediately by resetting your password, and contact your firm administrator.</p>`,
      button: { label: 'Reset password', url: input.forgotPasswordUrl },
    }),
    devPreviewUrl: input.forgotPasswordUrl,
  };
}

export function newSignInAlertEmail(input: {
  to: string; appName?: string; timestamp: string; device: string; location: string; ipAddress: string; forgotPasswordUrl: string;
}): Email {
  const appName = input.appName ?? 'Accmatica';
  return {
    to: input.to,
    subject: `New sign-in to your ${appName} account`,
    html: layout({
      heading: `New sign-in to your ${escapeHtml(appName)} account`,
      bodyHtml: `
        <p>We noticed a new sign-in to your account:</p>
        <p style="margin:0 0 4px 0;"><strong>Date:</strong> ${escapeHtml(input.timestamp)}</p>
        <p style="margin:0 0 4px 0;"><strong>Device:</strong> ${escapeHtml(input.device)}</p>
        <p style="margin:0 0 4px 0;"><strong>Location:</strong> ${escapeHtml(input.location)}</p>
        <p style="margin:0 0 16px 0;"><strong>IP address:</strong> ${escapeHtml(input.ipAddress)}</p>
        <p>If this was you, no action is needed.</p>
        <p>If this wasn't you, reset your password immediately and contact your administrator.</p>`,
      button: { label: 'Reset password', url: input.forgotPasswordUrl },
    }),
    devPreviewUrl: input.forgotPasswordUrl,
  };
}

export function accountDeactivatedEmail(input: { to: string; appName?: string }): Email {
  const appName = input.appName ?? 'Accmatica';
  return {
    to: input.to,
    subject: 'Your account has been deactivated',
    html: layout({
      heading: 'Your account has been deactivated',
      bodyHtml: `<p>Your ${escapeHtml(appName)} account was deactivated by a firm admin. You will not be able to sign in until it is reactivated. Contact your firm administrator with any questions.</p>`,
    }),
  };
}

export function accountReactivatedEmail(input: { to: string; appName?: string }): Email {
  const appName = input.appName ?? 'Accmatica';
  return {
    to: input.to,
    subject: 'Your account has been reactivated',
    html: layout({
      heading: 'Your account has been reactivated',
      bodyHtml: `<p>Your ${escapeHtml(appName)} account has been reactivated. You can sign in again as usual.</p>`,
    }),
  };
}

export function socialAccountLinkedEmail(input: { to: string; provider: 'Google' | 'Microsoft'; appName?: string }): Email {
  const appName = input.appName ?? 'Accmatica';
  return {
    to: input.to,
    subject: `Your ${input.provider} account has been linked`,
    html: layout({
      heading: `Your ${input.provider} account has been linked`,
      bodyHtml: `<p>Your ${input.provider} account has been linked to your ${escapeHtml(appName)} account. You can now sign in with ${input.provider} in addition to your password.</p>`,
    }),
  };
}
