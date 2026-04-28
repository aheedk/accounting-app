import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as fs from '../../src/services/files/fileService.js';

let t: TestDb;
let tempRoot: string;
beforeAll(async () => {
  t = await startTestDb();
  tempRoot = await mkdtemp(path.join(tmpdir(), 'fs-test-'));
  process.env['FILE_STORAGE_DIR'] = tempRoot;
});
beforeEach(async () => { await truncateAll(t.db); });
afterAll(async () => { await rm(tempRoot, { recursive: true, force: true }); });

describe('fileService', () => {
  it('uploadFile writes to disk + creates files row + streamFile returns buffer', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const buf = Buffer.from('test receipt content');
    const row = await t.db.transaction().execute(trx =>
      fs.uploadFile(trx, ctx, { business_id: biz.id, original_name: 'test.txt', mime_type: 'text/plain', buffer: buf }),
    );

    expect(row.business_id).toBe(biz.id);
    expect(row.uploaded_by_user_id).toBe(user.id);
    expect(row.storage_path).toMatch(/\.txt$/);

    const { buffer: back } = await fs.streamFile(t.db, biz.id, row.id);
    expect(back.equals(buf)).toBe(true);
  });
});
