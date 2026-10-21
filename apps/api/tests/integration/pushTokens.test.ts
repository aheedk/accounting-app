// apps/api/tests/integration/pushTokens.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

describe('push tokens', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  async function loginAs(email: string) {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email, password: 'pw12345678' });
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email, password: 'pw12345678' });
    return { app, user, token: login.body.access_token as string };
  }

  it('registers a token, then re-registering the same token upserts rather than duplicating', async () => {
    const { app, user, token } = await loginAs('a@x.com');

    const first = await request(app).post('/me/push-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'expo-token-abc', platform: 'ios' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/me/push-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'expo-token-abc', platform: 'android' });
    expect(second.status).toBe(201);

    const rows = await t.db.selectFrom('push_tokens').selectAll().where('token', '=', 'expo-token-abc').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.platform).toBe('android'); // the later registration's platform wins
    expect(rows[0]!.user_id).toBe(user.id);
  });

  it('a second user registering the same physical device (token reused after reinstall) reassigns it', async () => {
    const { app, token: tokenA } = await loginAs('a2@x.com');
    const { token: tokenB, user: userB } = await loginAs('b2@x.com');

    await request(app).post('/me/push-tokens').set('Authorization', `Bearer ${tokenA}`).send({ token: 'shared-device-token', platform: 'ios' });
    await request(app).post('/me/push-tokens').set('Authorization', `Bearer ${tokenB}`).send({ token: 'shared-device-token', platform: 'ios' });

    const rows = await t.db.selectFrom('push_tokens').selectAll().where('token', '=', 'shared-device-token').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(userB.id);
  });

  it('deletes only the caller\'s own token, not another user\'s token of the same value were it to exist', async () => {
    const { app, token } = await loginAs('c@x.com');
    await request(app).post('/me/push-tokens').set('Authorization', `Bearer ${token}`).send({ token: 'to-remove', platform: 'android' });

    const del = await request(app).delete('/me/push-tokens').set('Authorization', `Bearer ${token}`).send({ token: 'to-remove' });
    expect(del.status).toBe(200);

    const rows = await t.db.selectFrom('push_tokens').selectAll().where('token', '=', 'to-remove').execute();
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown platform value', async () => {
    const { app, token } = await loginAs('d@x.com');
    const res = await request(app).post('/me/push-tokens').set('Authorization', `Bearer ${token}`).send({ token: 'x', platform: 'web' });
    expect(res.status).toBe(400);
  });
});
