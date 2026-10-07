import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeVendor } from '../helpers/factories.js';
import { fetchVendors, buildVendorPromptSection, type ClientContext } from '../../src/jobs/gmailWorker.js';

// The AI extraction prompt only ever saw the account chart, never the
// client's actual vendors -- so a payee the bank printed differently from
// how the vendor is filed (a rename, an abbreviation) never matched. This
// grounds the prompt in the real vendor list, the same way it already is
// for the chart of accounts.
describe('gmailWorker vendor context for the extraction prompt', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('fetchVendors returns this business\'s active vendor names, alphabetized, excluding other tenants and soft deletes', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Vendor Context Biz');
    const other = await makeBusiness(t.db, firm.id, 'Other Biz');
    await makeVendor(t.db, biz.id, { name: 'Duke Energy' });
    await makeVendor(t.db, biz.id, { name: 'Action Lawn Maintenance' });
    const deleted = await makeVendor(t.db, biz.id, { name: 'Closed Vendor' });
    await t.db.updateTable('vendors').set({ deleted_at: new Date() }).where('id', '=', deleted.id).execute();
    await makeVendor(t.db, other.id, { name: 'Should Not Appear' });

    const names = await fetchVendors(t.db, biz.id);
    expect(names).toEqual(['Action Lawn Maintenance', 'Duke Energy']);
  });

  it('buildVendorPromptSection lists the vendors and instructs the model to prefer their exact names', () => {
    const ctx: ClientContext = { coa: [], vendorHistory: [], vendors: ['Duke Energy', 'Staples Inc'] };
    const section = buildVendorPromptSection(ctx);
    expect(section).toContain('KNOWN VENDORS');
    expect(section).toContain('Duke Energy, Staples Inc');
    expect(section).toMatch(/use the vendor's.*name exactly/i);
  });

  it('buildVendorPromptSection is empty with no client context or no vendors on file', () => {
    expect(buildVendorPromptSection(undefined)).toBe('');
    expect(buildVendorPromptSection({ coa: [], vendorHistory: [], vendors: [] })).toBe('');
  });
});
