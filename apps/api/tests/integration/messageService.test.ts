import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import { listMessages, markRead, postMessage, unreadCount } from '../../src/services/core/messageService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000e55a9', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Role audit 2026-10-08: a client had no way to ask the firm a question inside the app.
describe('messages between a client and the firm', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const green = await makeBusiness(t.db, firm.id, 'Green');
    const blue = await makeBusiness(t.db, firm.id, 'Blue');
    const client = await makeUser(t.db, firm.id, { full_name: 'Casey Client', role: 'client' });
    const accountant = await makeUser(t.db, firm.id, { full_name: 'Pat Accountant', role: 'accountant' });
    const ctx = (user: { id: string }, business_id: string): ServiceCtx =>
      ({ user_id: user.id, firm_id: firm.id, business_id, effective_role: 'accountant', ...meta });
    const say = async (user: { id: string }, business_id: string, body: string) => {
      await t.db.transaction().execute(trx => postMessage(trx, ctx(user, business_id), { business_id, body }));
      await new Promise(resolve => setTimeout(resolve, 5));
    };
    return { green, blue, client, accountant, say };
  }

  it('keeps one thread per company, oldest first, and says which messages are yours', async () => {
    const s = await setup();
    await s.say(s.client, s.green.id, '  Did the March rent go through?  ');
    await s.say(s.accountant, s.green.id, 'Yes, on the 3rd.');
    await s.say(s.accountant, s.blue.id, 'A different company.');

    const thread = await listMessages(t.db, { business_id: s.green.id, user_id: s.client.id, limit: 50 });
    expect(thread.has_more).toBe(false);
    expect(thread.messages.map(m => [m.author_name, m.body, m.mine])).toEqual([
      ['Casey Client', 'Did the March rent go through?', true],
      ['Pat Accountant', 'Yes, on the 3rd.', false],
    ]);

    // Paging back from the newest.
    const last = await listMessages(t.db, { business_id: s.green.id, user_id: s.client.id, limit: 1 });
    expect(last.messages.map(m => m.body)).toEqual(['Yes, on the 3rd.']);
    expect(last.has_more).toBe(true);
    const older = await listMessages(t.db, { business_id: s.green.id, user_id: s.client.id, limit: 1, before: last.messages[0]!.created_at });
    expect(older.messages.map(m => m.body)).toEqual(['Did the March rent go through?']);
  });

  it('counts what other people wrote since you last read the thread', async () => {
    const s = await setup();
    const unread = (user: { id: string }) => unreadCount(t.db, { business_id: s.green.id, user_id: user.id });

    await s.say(s.client, s.green.id, 'First question');
    await s.say(s.client, s.green.id, 'Second question');
    expect(await unread(s.accountant)).toBe(2);
    expect(await unread(s.client)).toBe(0);        // your own are never unread

    await markRead(t.db, { business_id: s.green.id, user_id: s.accountant.id });
    expect(await unread(s.accountant)).toBe(0);

    // Writing a reply marks the thread read for the writer, and unread for the other side.
    await s.say(s.client, s.green.id, 'Third');
    await s.say(s.accountant, s.green.id, 'Answers to all three');
    expect(await unread(s.accountant)).toBe(0);
    expect(await unread(s.client)).toBe(1);
  });
});
