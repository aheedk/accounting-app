import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { signGmailConnectState } from '../../src/services/auth/tokenService.js';

// Connecting the firm's Gmail decides whose mailbox feeds the AI inbox, so only a
// signed-in firm admin may start it, and the callback takes only a reply that
// carries the hand-off from that start.
describe('connecting the firm Gmail', () => {
  let t: TestDb;
  let credentialsPath: string;
  const savedPath = process.env.GMAIL_CREDENTIALS_PATH;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
    credentialsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-')), 'gmail-credentials.json');
    fs.writeFileSync(credentialsPath, JSON.stringify({
      web: { client_id: 'test-client', client_secret: 'test-secret', redirect_uris: ['http://localhost:4000/auth/gmail/callback'] },
    }));
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });
  afterEach(() => {
    if (savedPath === undefined) delete process.env.GMAIL_CREDENTIALS_PATH;
    else process.env.GMAIL_CREDENTIALS_PATH = savedPath;
  });

  async function signIn(role: 'firm_admin' | 'accountant') {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: `${role}@gmail.test`, password: 'pw12345678', role });
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: `${role}@gmail.test`, password: 'pw12345678' });
    return { app, user, firm, token: login.body.access_token as string };
  }

  it('no longer starts from an open address', async () => {
    process.env.GMAIL_CREDENTIALS_PATH = credentialsPath;
    const res = await request(makeApp()).get('/auth/gmail');
    // Refused (no such route; the sign-in check answers first), never sent on to Google.
    expect([401, 404]).toContain(res.status);
    expect(res.headers['location']).toBeUndefined();
  });

  it('starts only for a signed-in firm admin, with a state for the callback', async () => {
    process.env.GMAIL_CREDENTIALS_PATH = credentialsPath;
    const anonymous = await request(makeApp()).post('/gmail/connect');
    expect(anonymous.status).toBe(401);

    const accountant = await signIn('accountant');
    const refused = await request(accountant.app).post('/gmail/connect').set('Authorization', `Bearer ${accountant.token}`);
    expect(refused.status).toBe(403);

    await truncateAll(t.db);
    const admin = await signIn('firm_admin');
    const res = await request(admin.app).post('/gmail/connect').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const url = new URL(res.body.url as string);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('says so when the server has no Google credentials, rather than failing', async () => {
    process.env.GMAIL_CREDENTIALS_PATH = path.join(os.tmpdir(), 'no-such-dir', 'gmail-credentials.json');
    const admin = await signIn('firm_admin');
    const res = await request(admin.app).post('/gmail/connect').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('the callback refuses a reply without the hand-off, a forged one, or one for someone not a firm admin', async () => {
    const accountant = await signIn('accountant');
    const app = accountant.app;

    expect((await request(app).get('/auth/gmail/callback?code=abc')).status).toBe(400);
    expect((await request(app).get('/auth/gmail/callback?code=abc&state=not-a-token')).status).toBe(400);
    // A sign-in token is not a hand-off, even though it is signed with the same key.
    expect((await request(app).get(`/auth/gmail/callback?code=abc&state=${accountant.token}`)).status).toBe(400);

    const notAdmin = signGmailConnectState({ user_id: accountant.user.id, firm_id: accountant.firm.id });
    const res = await request(app).get(`/auth/gmail/callback?code=abc&state=${notAdmin}`);
    expect(res.status).toBe(403);
  });

  it('the callback lets a firm admin hand-off through to Google', async () => {
    // With no credentials it stops right after the checks, which shows they passed.
    process.env.GMAIL_CREDENTIALS_PATH = path.join(os.tmpdir(), 'no-such-dir', 'gmail-credentials.json');
    const admin = await signIn('firm_admin');
    const state = signGmailConnectState({ user_id: admin.user.id, firm_id: admin.firm.id });
    const res = await request(admin.app).get(`/auth/gmail/callback?code=abc&state=${state}`);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
    expect(res.body.error?.code).toBe('PRECONDITION_FAILED');
  });
});
