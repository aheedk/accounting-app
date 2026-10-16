import { Router } from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { AUDIT, ERR } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import { triggerPoll } from '../jobs/gmailWorker.js';
import { BusinessRuleError } from '../lib/errors.js';
import { signGmailConnectState, verifyGmailConnectState } from '../services/auth/tokenService.js';
import { record as auditRecord } from '../services/audit/auditService.js';

const router = Router();
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH_FOR_TOKEN = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
const TOKEN_PATH = path.join(path.dirname(CREDENTIALS_PATH_FOR_TOKEN), 'gmail-token.json');

function getOAuth2Client() {
  const credPath = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
  if (!fs.existsSync(credPath)) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'Gmail is not set up on this server: its Google credentials file is missing.');
  const { web } = JSON.parse(fs.readFileSync(credPath, 'utf8')) as { web: { client_id: string; client_secret: string; redirect_uris: string[] } };
  return new google.auth.OAuth2(web.client_id, web.client_secret, web.redirect_uris[0]);
}

// Connecting the firm's Gmail decides whose mailbox feeds the AI inbox, so only
// a signed-in firm admin may start it (it was an open GET /auth/gmail, which
// let anyone who could reach the API put their own mailbox in the firm's place).
// Step 1 — the app asks for Google's consent page and sends the admin there.
router.post('/gmail/connect', requireAuth, requireMinRole('firm_admin'), (req, res, next) => {
  try {
    const auth = getOAuth2Client();
    const state = signGmailConnectState({ user_id: req.auth!.user_id, firm_id: req.auth!.firm_id });
    const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent', state });
    res.json({ url });
  } catch (e: unknown) {
    next(e);
  }
});

// Step 2 — Google redirects here after consent. Only a reply carrying the state
// from step 1, from a firm admin who still is one, is taken.
router.get('/auth/gmail/callback', async (req, res, next) => {
  const code = req.query.code as string | undefined;
  const started = verifyGmailConnectState(req.query.state as string | undefined);
  if (!started) {
    res.status(400).send('<h2>Gmail was not connected</h2><p>This link did not come from the app, or it is more than 10 minutes old. Sign in as a firm admin and use Connect Gmail.</p>');
    return;
  }
  if (!code) { res.status(400).send('Missing code parameter'); return; }
  try {
    const admin = await db.selectFrom('users').select(['id'])
      .where('id', '=', started.user_id).where('firm_id', '=', started.firm_id).where('role', '=', 'firm_admin')
      .where('deleted_at', 'is', null).where('deactivated_at', 'is', null)
      .executeTakeFirst();
    if (!admin) { res.status(403).send('<h2>Gmail was not connected</h2><p>Only a firm admin can connect Gmail.</p>'); return; }
    const auth = getOAuth2Client();
    const { tokens } = await auth.getToken(code);
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    await db.transaction().execute(trx => auditRecord(trx, {
      user_id: started.user_id, firm_id: started.firm_id, business_id: null, effective_role: 'firm_admin',
      request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0', user_agent: req.header('user-agent') ?? '',
    }, { action: AUDIT.GMAIL_CONNECT, entity_type: 'gmail', entity_id: null, before: null, after: { connected: true } }));
    res.send('<h2>Gmail connected</h2><p>The AI inbox will read it from now on. You can close this tab.</p>');
  } catch (e: unknown) {
    next(e);
  }
});

// Manually trigger an immediate Gmail poll — returns immediately, runs in background
router.post('/email-imports/poll', requireAuth, requireMinRole('accountant'), (_req, res) => {
  void triggerPoll(db).catch((e: unknown) => {
    console.error('[gmail-worker] manual poll error:', e instanceof Error ? e.message : e);
  });
  res.json({ ok: true });
});

export default router;
