// The firm's own roles (docs/specs/2026-11-09-custom-roles-design.md), through the HTTP layer.
//
// The strongest check is the first: a custom role with one level in every area
// is let into exactly what the built-in role of that level is, route by route,
// across the whole API. Everything else here is what only a custom role does.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AREAS, apiPlaceOf, type Level, type Permissions } from '@accounting/shared';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

const PASSWORD = 'pw12345678';
const ZERO = '00000000-0000-0000-0000-000000000000';
const BIZ = '/businesses/:businessId';
const year = new Date().getUTCFullYear();

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };
function businessRoutes(app: Express): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path });
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack);
  return out.filter(r => r.path.startsWith(BIZ));
}

const every = (level: Level): Permissions => Object.fromEntries(AREAS.map(area => [area, level])) as Permissions;

describe('custom roles', () => {
  let t: TestDb;
  let app: Express;
  let firmId: string;
  let bizId: string;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
    app = makeApp();
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    const firm = await makeFirm(t.db);
    firmId = firm.id;
    const biz = await makeBusiness(t.db, firm.id, 'Roles Co');
    bizId = biz.id;
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, year);
    await makeUser(t.db, firm.id, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
  });

  async function signIn(email: string) {
    const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body as { access_token: string; user: Record<string, unknown>; businesses: Array<Record<string, unknown>> };
  }
  function as(token: string) {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(app).get(url)),
      post: (url: string, body: object = {}) => auth(request(app).post(url)).send(body),
      patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
      delete: (url: string) => auth(request(app).delete(url)),
    };
  }
  async function admin() { return as((await signIn('admin@x.com')).access_token); }
  async function makeRole(name: string, permissions: Permissions): Promise<string> {
    const res = await (await admin()).post('/me/firm/roles', { name, permissions });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  /** A login with a custom role, made the way a firm admin makes one, granted the company. */
  async function makeLogin(email: string, custom_role_id: string) {
    const user = await makeUser(t.db, firmId, { email, password: PASSWORD, role: 'staff' });
    const set = await (await admin()).patch(`/me/firm/users/${user.id}`, { custom_role_id });
    expect(set.status).toBe(200);
    await grantAccess(t.db, user.id, bizId);
    return user;
  }

  it('every business route is in an area', () => {
    const unplaced = businessRoutes(app)
      .filter(r => !apiPlaceOf(r.method, r.path.slice(BIZ.length).replace(/:[A-Za-z]+/g, ZERO) || '/'))
      .map(r => `${r.method} ${r.path}`);
    expect(unplaced).toEqual([]);
  });

  it('one level everywhere is let into exactly what the built-in role of that level is', async () => {
    const pairs = [['view', 'viewer'], ['enter', 'staff'], ['post', 'accountant'], ['full', 'firm_admin']] as const;
    const tokens: Record<string, string> = {};
    for (const [level, role] of pairs) {
      const builtIn = await makeUser(t.db, firmId, { email: `${role}@x.com`, password: PASSWORD, role });
      await grantAccess(t.db, builtIn.id, bizId);
      tokens[role] = (await signIn(`${role}@x.com`)).access_token;
      await makeLogin(`custom-${level}@x.com`, await makeRole(`All ${level}`, every(level)));
      tokens[level] = (await signIn(`custom-${level}@x.com`)).access_token;
    }
    const differences: string[] = [];
    for (const route of businessRoutes(app)) {
      const url = route.path.replace(':businessId', bizId).replace(/:[A-Za-z]+/g, ZERO);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
      for (const [level, role] of pairs) {
        const call = async (token: string) => {
          let r = request(app)[method](url).set('Authorization', `Bearer ${token}`);
          if (method !== 'get') r = r.send({});
          return (await r).status;
        };
        const builtIn = await call(tokens[role]!);
        const custom = await call(tokens[level]!);
        if ((builtIn === 403) !== (custom === 403)) differences.push(`${route.method} ${route.path}: ${role} ${builtIn}, all-${level} ${custom}`);
      }
    }
    expect(differences).toEqual([]);
  }, 600_000);

  it('each area goes as far as its level, and lookups stay open', async () => {
    const roleId = await makeRole('Sales clerk', {
      ...every('none'), sales: 'post', purchases: 'view', reports: 'view',
    });
    await makeLogin('clerk@x.com', roleId);
    const clerk = as((await signIn('clerk@x.com')).access_token);
    const b = `/businesses/${bizId}`;
    expect((await clerk.get(`${b}/invoices`)).status).toBe(200);
    expect((await clerk.post(`${b}/invoices/${ZERO}/post`)).status).not.toBe(403); // Post in Sales: an accountant's route
    expect((await clerk.get(`${b}/bills`)).status).toBe(200);
    expect((await clerk.post(`${b}/bills`)).status).toBe(403); // View in Expenses & bills
    const payroll = await clerk.get(`${b}/employees`);
    expect(payroll.status).toBe(403);
    expect(payroll.body.error.message).toMatch(/Payroll/);
    expect((await clerk.get(`${b}/journal-entries`)).status).toBe(403);
    expect((await clerk.get(`${b}/coa`)).status).toBe(200); // a lookup every form needs
    expect((await clerk.get(`${b}/reports/pnl`)).status).not.toBe(403);
    expect((await clerk.get(`${b}/chat/conversations`)).status).toBe(403); // the chat reads banking and the ledger too
    // Nothing of the firm's own.
    expect((await clerk.get('/me/firm/users')).status).toBe(403);
    expect((await clerk.get('/me/firm/roles')).status).toBe(403);
  });

  it('a role for one company wins over the login\'s own there', async () => {
    const viewSales = await makeRole('Sales viewer', { ...every('none'), sales: 'view' });
    const user = await makeUser(t.db, firmId, { email: 'acct@x.com', password: PASSWORD, role: 'accountant' });
    const grant = await (await admin()).post(`/me/firm/users/${user.id}/business-access`, { business_id: bizId, custom_role_id: viewSales });
    expect(grant.status).toBe(201);
    const acct = as((await signIn('acct@x.com')).access_token);
    expect((await acct.get(`/businesses/${bizId}/invoices`)).status).toBe(200);
    expect((await acct.get(`/businesses/${bizId}/journal-entries`)).status).toBe(403);
  });

  it('sign-in, renewal and /me carry the role, so the web app can draw the menu', async () => {
    const roleId = await makeRole('Bookkeeper', { ...every('enter'), payroll: 'none' });
    await makeLogin('bk@x.com', roleId);
    const login = await signIn('bk@x.com');
    expect(login.user).toMatchObject({ role: 'staff', custom_role: { id: roleId, name: 'Bookkeeper', permissions: { payroll: 'none', sales: 'enter' } } });
    expect(login.businesses[0]).toMatchObject({ id: bizId, custom_role: null });
    const me = await as(login.access_token).get('/me');
    expect(me.body.user.custom_role).toMatchObject({ id: roleId, name: 'Bookkeeper' });
  });

  it('changing a role holds at once, and sends its holders\' browsers to renew', async () => {
    const roleId = await makeRole('Changing', { ...every('none'), reports: 'view' });
    await makeLogin('c@x.com', roleId);
    const before = as((await signIn('c@x.com')).access_token);
    expect((await before.get(`/businesses/${bizId}/invoices`)).status).toBe(403);
    const patched = await (await admin()).patch(`/me/firm/roles/${roleId}`, { permissions: { ...every('none'), sales: 'view' } });
    expect(patched.status).toBe(200);
    // The old token stops counting (the browser renews into the new menu) ...
    expect((await before.get(`/businesses/${bizId}/invoices`)).status).toBe(401);
    // ... and the new levels apply.
    const after = as((await signIn('c@x.com')).access_token);
    expect((await after.get(`/businesses/${bizId}/invoices`)).status).toBe(200);
    expect((await after.get(`/businesses/${bizId}/reports/pnl`)).status).toBe(403);
  });

  it('a role is named once, cannot take a built-in name, and is deleted only when unused', async () => {
    const a = await admin();
    const roleId = await makeRole('Auditor', every('view'));
    expect((await a.post('/me/firm/roles', { name: 'auditor', permissions: every('view') })).status).toBe(409);
    expect((await a.post('/me/firm/roles', { name: 'Staff', permissions: every('view') })).status).toBe(400);
    expect((await a.post('/me/firm/roles', { name: 'Partial', permissions: { sales: 'view' } })).status).toBe(400);
    const user = await makeLogin('aud@x.com', roleId);
    const refused = await a.delete(`/me/firm/roles/${roleId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/in use/);
    const listed = await a.get('/me/firm/roles');
    expect(listed.body.roles[0]).toMatchObject({ name: 'Auditor', users: [{ id: user.id }] });
    expect((await a.patch(`/me/firm/users/${user.id}`, { role: 'viewer' })).status).toBe(200);
    expect((await a.delete(`/me/firm/roles/${roleId}`)).status).toBe(204);
    const actions = await t.db.selectFrom('audit_logs').select('action').where('entity_type', '=', 'role').orderBy('created_at').execute();
    expect(actions.map(r => r.action)).toEqual(['role.create', 'role.delete']);
  });

  it('a login given a custom role is stored as staff, and a firm admin moved to one stops being a firm admin', async () => {
    const roleId = await makeRole('Limited', every('view'));
    const other = await makeUser(t.db, firmId, { email: 'admin2@x.com', password: PASSWORD, role: 'firm_admin' });
    expect((await (await admin()).patch(`/me/firm/users/${other.id}`, { custom_role_id: roleId })).status).toBe(200);
    const row = await t.db.selectFrom('users').select(['role', 'custom_role_id']).where('id', '=', other.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ role: 'staff', custom_role_id: roleId });
    expect((await as((await signIn('admin2@x.com')).access_token).get('/me/firm/users')).status).toBe(403);
  });

  it('entries wait for approval at Enter, and only Post in their own area approves them', async () => {
    const cashId = (await makeAccount(t.db, bizId, { code: '1099', name: 'Petty Cash', account_type: 'asset' })).id;
    const suppliesId = (await makeAccount(t.db, bizId, { code: '6199', name: 'Supplies', account_type: 'expense' })).id;
    await makeLogin('clerk@x.com', await makeRole('Clerk', { ...every('view'), purchases: 'enter' }));
    await makeLogin('reviewer@x.com', await makeRole('Reviewer', { ...every('view'), accounting: 'post', purchases: 'enter' }));
    await makeLogin('senior@x.com', await makeRole('Senior', { ...every('view'), accounting: 'post', purchases: 'post' }));
    const b = `/businesses/${bizId}`;
    expect((await (await admin()).patch(b, { staff_entries_need_approval: true })).status).toBe(200);

    const clerk = as((await signIn('clerk@x.com')).access_token);
    const held = await clerk.post(`${b}/expense-transactions`, {
      transaction_date: `${year}-06-15`, payee_text: 'Staples', payment_account_id: cashId, payment_method: 'cash',
      lines: [{ category_account_id: suppliesId, amount: '45.00' }],
    });
    expect(held.status).toBe(202);
    const approvalId = held.body.approval_id as string;

    const reviewer = as((await signIn('reviewer@x.com')).access_token);
    const refused = await reviewer.post(`${b}/approvals/${approvalId}/approve`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/Expenses & bills/);

    const senior = as((await signIn('senior@x.com')).access_token);
    const approved = await senior.post(`${b}/approvals/${approvalId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
  });
});
