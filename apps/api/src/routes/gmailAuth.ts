import { Router } from 'express';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { triggerPoll } from '../jobs/gmailWorker.js';

const router = Router();
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH_FOR_TOKEN = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
const TOKEN_PATH = path.join(path.dirname(CREDENTIALS_PATH_FOR_TOKEN), 'gmail-token.json');

function getOAuth2Client() {
  const credPath = path.resolve(process.env.GMAIL_CREDENTIALS_PATH ?? 'secrets/gmail-credentials.json');
  if (!fs.existsSync(credPath)) throw new Error(`Gmail credentials not found at ${credPath}`);
  const { web } = JSON.parse(fs.readFileSync(credPath, 'utf8')) as { web: { client_id: string; client_secret: string; redirect_uris: string[] } };
  return new google.auth.OAuth2(web.client_id, web.client_secret, web.redirect_uris[0]);
}

// Step 1 — visit http://localhost:4000/auth/gmail to start the flow
router.get('/auth/gmail', (_req, res) => {
  try {
    const auth = getOAuth2Client();
    const url = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    res.redirect(url);
  } catch (e: unknown) {
    res.status(500).send(e instanceof Error ? e.message : 'Failed to start Gmail auth');
  }
});

// Step 2 — Google redirects here after the user grants permission
router.get('/auth/gmail/callback', async (req, res, next) => {
  const code = req.query.code as string | undefined;
  if (!code) { res.status(400).send('Missing code parameter'); return; }
  try {
    const auth = getOAuth2Client();
    const { tokens } = await auth.getToken(code);
    fs.mkdirSync(path.resolve('secrets'), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    res.send('<h2>Gmail authorized!</h2><p>Token saved. You can close this tab and restart the dev server.</p>');
  } catch (e: unknown) {
    next(e);
  }
});

// Manually trigger an immediate Gmail poll — returns immediately, runs in background
router.post('/email-imports/poll', requireAuth, (_req, res) => {
  void triggerPoll(db).catch((e: unknown) => {
    console.error('[gmail-worker] manual poll error:', e instanceof Error ? e.message : e);
  });
  res.json({ ok: true });
});

export default router;
