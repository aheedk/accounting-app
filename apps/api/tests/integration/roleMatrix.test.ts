// Every route, called as every role. The routes are read from the running app,
// so a route added later is covered without touching this file — and has to be
// placed in one of the lists below, which is the point: who may do what is
// decided on purpose, not by whichever guard a new route happened to get.
//
// Ids are all-zero and bodies are empty, so a request that gets past the role
// check stops at "not found" or "invalid". 403 therefore means exactly "this
// role is refused", and anything else means "this role is let in".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { clientMayRequest } from '../../src/lib/clientAccess.js';

const ROLES = ['client', 'staff', 'accountant', 'firm_admin'] as const;
type RoleName = (typeof ROLES)[number];
type RouteDef = { method: string; path: string };
type Row = RouteDef & Record<RoleName, number>;

const ZERO = '00000000-0000-0000-0000-000000000000';
const BIZ = '/businesses/:businessId';

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

function listRoutes(app: Express): RouteDef[] {
  const out: RouteDef[] = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack);
  return out;
}

const name = (r: RouteDef) => `${r.method} ${r.path.replace(BIZ, '~')}`;

// What staff may change. Everything here is data entry: master records, drafts,
// documents that are not in the ledger, and the day-to-day entries (expenses,
// checks, deposits, bank lines) that post as they are saved. Posting an invoice
// or a bill, voiding, payroll, periods and settings are not here.
const STAFF_MAY_WRITE = [
  'PATCH ~/bank-deposits/:id',
  'PATCH ~/bank-rules/:id',
  'PATCH ~/checks/:id',
  'PATCH ~/custom-reports/:id',
  'PATCH ~/expense-transactions/:id',
  'PATCH ~/fixed-assets/:id',
  'PATCH ~/inventory-items/:id',
  'PATCH ~/receipts/:id/link',
  'POST ~/bank-deposits',
  'POST ~/bank-imports/:id/undo',
  'POST ~/bank-rules',
  'POST ~/bank-rules/apply',
  'POST ~/bank-rules/dry-run',
  'POST ~/bank-transactions/:id/categorize',
  'POST ~/bank-transactions/:id/exclude',
  'POST ~/bank-transactions/:id/match',
  'POST ~/bank-transactions/import',
  'POST ~/bill-payments',
  'POST ~/bill-payments/:id/applications',
  'POST ~/bills',
  'POST ~/checks',
  'POST ~/custom-reports',
  'POST ~/custom-reports/:id/run',
  'POST ~/custom-reports/run',
  'POST ~/customers',
  'POST ~/email-imports/:importId/already-recorded',
  'POST ~/expense-transactions',
  'POST ~/files',
  'POST ~/fixed-assets',
  'POST ~/integration-inbox/:id/categorize',
  'POST ~/integration-inbox/:id/exclude',
  'POST ~/integration-inbox/:id/match',
  'POST ~/integration-inbox/import',
  'POST ~/inventory-items',
  'POST ~/inventory-items/:id/adjust-stock',
  'POST ~/invoices',
  'POST ~/item-receipts',
  'POST ~/payments',
  'POST ~/payments/:id/applications',
  'POST ~/purchase-orders',
  'POST ~/receipts',
  'POST ~/sales-orders',
  'POST ~/shipping-labels',
  'POST ~/vendors',
];

// What only a firm admin may do: the firm's users and clients (adding one,
// switching a login off, resetting its password or second step, signing it
// out), a client's settings, bank accounts, tax codes and employees, deleting
// records, reopening a period, and revealing a tax id or social security number.
const FIRM_ADMIN_ONLY = [
  'DELETE /me/firm/users/:id/business-access/:businessId',
  'DELETE ~/bank-deposits/:id',
  'DELETE ~/budgets/:id',
  'DELETE ~/checks/:id',
  'DELETE ~/customers/:id',
  'DELETE ~/employees/:id',
  'DELETE ~/expense-transactions/:id',
  'DELETE ~/journal-entries/:id',
  'DELETE ~/vendors/:id',
  'GET /firm-overview',
  'GET /me/firm/activity-log',
  'GET /me/firm/users',
  'GET ~/employees/:id/ssn-reveal',
  'GET ~/vendors/:id/tax-id-reveal',
  'PATCH /me/firm/users/:id',
  'PATCH ~',
  'PATCH ~/bank-accounts/:id',
  'PATCH ~/tax-codes/:id',
  'POST /firm/businesses',
  'POST /me/firm/users',
  'POST /me/firm/users/:id/business-access',
  'POST /me/firm/users/:id/deactivate',
  'POST /me/firm/users/:id/reactivate',
  'POST /me/firm/users/:id/reset-password',
  'POST /me/firm/users/:id/reset-two-step',
  'POST /me/firm/users/:id/sign-out',
  'POST ~/bank-accounts',
  'POST ~/employees',
  'POST ~/periods/:id/reopen',
  'POST ~/periods/seed-year',
  'POST ~/tax-codes',
];

describe('role matrix', () => {
  let t: TestDb;
  const rows: Row[] = [];

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
    await truncateAll(t.db);
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Role Matrix Co');
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, new Date().getUTCFullYear());
    const app = makeApp();
    const tokens = {} as Record<RoleName, string>;
    for (const role of ROLES) {
      const email = `${role}@roles.test`;
      const user = await makeUser(t.db, firm.id, { email, password: 'pw12345678', role });
      await grantAccess(t.db, user.id, biz.id);
      const login = await request(app).post('/auth/login').send({ email, password: 'pw12345678' });
      tokens[role] = login.body.access_token as string;
    }

    // Signing in and out, the health check and the Gmail hand-off have no role.
    const routes = listRoutes(app).filter(r => !r.path.startsWith('/auth/') && r.path !== '/health');
    for (const route of routes) {
      const url = route.path.replace(':businessId', biz.id).replace(/:[A-Za-z]+/g, ZERO);
      const row = { ...route } as Row;
      // Lowest role first, so nothing a higher role is let do changes what a lower one finds.
      for (const role of ROLES) {
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        let req = request(app)[method](url).set('Authorization', `Bearer ${tokens[role]}`);
        if (method !== 'get') req = req.send({});
        row[role] = (await req).status;
      }
      rows.push(row);
    }
    // ROLE_MATRIX_OUT=<file> writes the whole table, for the write-up in docs/qa.
    if (process.env.ROLE_MATRIX_OUT) fs.writeFileSync(process.env.ROLE_MATRIX_OUT, JSON.stringify(rows, null, 1));
  }, 600_000);

  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });

  it('covers the whole API and nothing falls over', () => {
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.filter(r => ROLES.some(role => r[role] >= 500)).map(name)).toEqual([]);
  });

  it('a client can read its reports and invoices, and nothing else', () => {
    const inBusiness = rows.filter(r => r.path.startsWith(BIZ));
    const allowed = (r: Row) => clientMayRequest(r.method, r.path.slice(BIZ.length).replace(/:[A-Za-z]+/g, ZERO) || '/');
    // Refused everything that is not on the list ...
    expect(inBusiness.filter(r => !allowed(r) && r.client !== 403).map(name)).toEqual([]);
    // ... and let in to exactly what is.
    const opened = inBusiness.filter(r => r.client !== 403).map(name).sort();
    expect(opened).toEqual([
      'GET ~',
      'GET ~/csv-exports/trial-balance',
      'GET ~/customers',
      'GET ~/customers/:id',
      'GET ~/invoices',
      'GET ~/invoices/:id',
      'GET ~/reports/aging',
      'GET ~/reports/ap-aging',
      'GET ~/reports/balance-sheet',
      'GET ~/reports/pnl',
      'GET ~/reports/statement-of-cash-flows',
      'GET ~/reports/trial-balance',
    ]);
  });

  it('a client changes nothing, anywhere', () => {
    expect(rows.filter(r => r.method !== 'GET' && r.client !== 403).map(name)).toEqual([]);
  });

  it('outside a business, a client sees only its own login', () => {
    const firmLevel = rows.filter(r => !r.path.startsWith(BIZ) && r.client !== 403).map(name);
    expect(firmLevel).toEqual(['GET /me']);
  });

  it('staff may change exactly what is listed', () => {
    const staffWrites = rows.filter(r => r.method !== 'GET' && r.staff !== 403).map(name).sort();
    expect(staffWrites).toEqual([...STAFF_MAY_WRITE].sort());
  });

  it('staff can read everything an accountant can, except the activity log', () => {
    // The log shows what everyone did, with each record before and after.
    expect(rows.filter(r => r.method === 'GET' && r.staff === 403 && r.accountant !== 403).map(name)).toEqual(['GET ~/activity-log']);
  });

  it('only a firm admin may do exactly what is listed', () => {
    const adminOnly = rows.filter(r => r.accountant === 403 && r.firm_admin !== 403).map(name).sort();
    expect(adminOnly).toEqual([...FIRM_ADMIN_ONLY].sort());
  });

  it('a firm admin is refused nothing', () => {
    expect(rows.filter(r => r.firm_admin === 403).map(name)).toEqual([]);
  });
});
