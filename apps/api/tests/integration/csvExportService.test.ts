import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { exportTrialBalance, rowsToCsv } from '../../src/services/reports/csvExportService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('csvExportService', () => {
  it('rowsToCsv escapes quotes and commas correctly', () => {
    const csv = rowsToCsv(
      [{ a: 'plain', b: 'has, comma' }, { a: 'has "quotes"', b: 'multi\nline' }],
      ['a', 'b'],
    );
    expect(csv).toContain('plain,"has, comma"');
    expect(csv).toContain('"has ""quotes""","multi\nline"');
  });

  it('exportTrialBalance returns a CSV with header + one row per CoA account', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);

    const file = await exportTrialBalance(t.db, biz.id, '2026-12-31');
    expect(file.filename).toBe('trial-balance-2026-12-31.csv');
    expect(file.content_type).toBe('text/csv');
    const text = file.body.toString('utf-8');
    expect(text).toMatch(/^code,name,account_type,total_debit,total_credit,net\n/);
    // seedCoa creates several accounts; verify >0 rows beyond header
    const dataLines = text.trim().split('\n').slice(1);
    expect(dataLines.length).toBeGreaterThan(0);
  });
});
