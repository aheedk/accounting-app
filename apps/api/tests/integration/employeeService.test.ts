import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as emp from '../../src/services/payroll/employeeService.js';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
  process.env['FIELD_ENCRYPTION_KEY'] =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});
beforeEach(async () => { await truncateAll(t.db); });

describe('employeeService', () => {
  it('createEmployee with ssn stores encrypted blob + last_four', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const e = await t.db.transaction().execute(trx =>
      emp.createEmployee(trx, ctx, {
        business_id: biz.id, full_name: 'Alice', hire_date: '2026-01-01', ssn: '123-45-6789',
      }),
    );
    expect(e.ssn_last_four).toBe('6789');
    expect(e.ssn_encrypted).toBeInstanceOf(Buffer);

    const revealed = await emp.revealSSN(t.db, ctx, e.id);
    expect(revealed).toBe('123-45-6789');
  });

  it('revealSSN audit-logs every call', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const e = await t.db.transaction().execute(trx =>
      emp.createEmployee(trx, ctx, {
        business_id: biz.id, full_name: 'Bob', hire_date: '2026-01-01', ssn: '987-65-4321',
      }),
    );
    await emp.revealSSN(t.db, ctx, e.id);
    await emp.revealSSN(t.db, ctx, e.id);

    const logs = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'employee.ssn_reveal').execute();
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});
