import type { Transaction } from 'kysely';
import type { schemas } from '@accounting/shared';
import { isZero, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';
import { createAccount, updateAccount } from '../core/chartOfAccountsService.js';
import { createCustomer } from '../ar/customerService.js';
import { createVendor } from '../ap/vendorService.js';
import { createItem } from '../inventory/inventoryItemService.js';
import { adjustStock } from '../inventory/stockMovementService.js';
import {
  createBatch, dateProblems, emptyResult, guardProblems, type QbImportResult, type QbRecord,
} from './qbBatches.js';
import { accountPaths, makeAccountMatcher, nameParts, norm, type MatchableAccount } from './qbMatch.js';

// Step 1 of moving a client from QuickBooks: the lists. Nothing here posts but
// a stock item's opening quantity. A name already here is left as it is.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

export async function loadAccounts(trx: Transaction<DB>, business_id: string): Promise<MatchableAccount[]> {
  return trx.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'parent_id', 'account_type', 'detail_type', 'is_active', 'is_locked', 'system_key'])
    .where('business_id', '=', business_id).execute();
}

// Where an account QuickBooks gave no number gets one: every tenth number in
// its type's range, then any free one. Cost of goods sold sits before expenses.
const RANGES: Record<string, [number, number]> = {
  asset: [1000, 1999], liability: [2000, 2999], equity: [3000, 3999], revenue: [4000, 4999], expense: [6000, 9999],
};
const COGS_RANGE: [number, number] = [5000, 5999];

function nextCode(taken: Set<string>, account_type: string, detail_type: string | null): string {
  const [start, end] = account_type === 'expense' && /cogs|cost of/i.test(detail_type ?? '') ? COGS_RANGE : RANGES[account_type]!;
  for (let c = start + 10; c <= end; c += 10) if (!taken.has(String(c))) return String(c);
  for (let c = start; c <= end; c++) if (!taken.has(String(c))) return String(c);
  let n = end + 1;
  while (taken.has(String(n))) n++;
  return String(n);
}

/** The app's own Accounts Receivable, Accounts Payable and Retained Earnings stand for QuickBooks' ones. */
function systemKeyFor(row: { account_type: string; detail_type?: string | null | undefined }, leaf: string): string | null {
  const detail = norm(row.detail_type ?? '');
  const name = norm(leaf);
  if (row.account_type === 'asset' && (detail.startsWith('accounts receivable') || name.startsWith('accounts receivable'))) return 'accounts_receivable';
  if (row.account_type === 'liability' && (detail.startsWith('accounts payable') || detail === 'ap' || name.startsWith('accounts payable'))) return 'accounts_payable';
  if (row.account_type === 'equity' && (detail === 'retained earnings' || name === 'retained earnings')) return 'retained_earnings';
  return null;
}

const TYPE_LABEL: Record<string, string> = { asset: 'an asset', liability: 'a liability', equity: 'an equity', revenue: 'an income', expense: 'an expense' };

export async function importAccounts(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbAccountsImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'accounts', input.cutover_date, false));

  const existing = await loadAccounts(trx, business_id);
  const paths = accountPaths(existing);
  const pathToAccount = new Map(existing.map(a => [norm(paths.get(a.id)!), { id: a.id, account_type: a.account_type }]));
  const taken = new Set(existing.map(a => a.code));
  const systemUsed = new Set<string>();
  const records: QbRecord[] = [];
  let created = 0;
  let matched = 0;

  // Parents before their sub-accounts.
  const rows = input.rows.map((row, i) => ({ row, i, ...nameParts(row.name) }))
    .sort((a, b) => a.parts.length - b.parts.length || a.i - b.i);
  for (const { row, i, parts, number: inName } of rows) {
    if (parts.length === 0) { result.problems.push({ row: i, message: 'No account name' }); continue; }
    const leaf = parts.at(-1)!;
    const path = norm(parts.join(':'));
    const number = row.number?.trim() || inName;
    const detail_type = row.detail_type?.trim() || null;

    const same = pathToAccount.get(path);
    if (same) {
      if (same.account_type !== row.account_type) {
        result.problems.push({ row: i, message: `"${row.name}" is already here as ${TYPE_LABEL[same.account_type]} account; QuickBooks has it as ${TYPE_LABEL[row.account_type]} account` });
      } else matched++;
      continue;
    }

    const key = parts.length === 1 ? systemKeyFor(row, leaf) : null;
    const system = key && !systemUsed.has(key) ? existing.find(a => a.system_key === key) : undefined;
    if (system) {
      systemUsed.add(key!);
      const patch: { name?: string; code?: string } = {};
      if (system.name !== leaf) patch.name = leaf;
      if (number && number !== system.code && !taken.has(number)) patch.code = number;
      if (Object.keys(patch).length > 0) {
        await updateAccount(trx, ctx, { account_id: system.id, patch });
        records.push({ entity_type: 'account_renamed', entity_id: system.id, previous: { name: system.name, code: system.code } });
        if (patch.code) taken.add(patch.code);
        result.notes.push(`${system.code} ${system.name} is this company's own ${leaf}; it takes QuickBooks' name${patch.code ? ' and number' : ''}`);
      }
      pathToAccount.set(path, { id: system.id, account_type: system.account_type });
      matched++;
      continue;
    }

    let parent_id: string | null = null;
    if (parts.length > 1) {
      const parent = pathToAccount.get(norm(parts.slice(0, -1).join(':')));
      if (!parent) {
        result.problems.push({ row: i, message: `"${row.name}" is a sub-account of "${parts.slice(0, -1).join(':')}", which is neither here nor in the upload` });
        continue;
      }
      if (parent.account_type !== row.account_type) {
        result.problems.push({ row: i, message: `"${row.name}" is not the same type as the account it is under` });
        continue;
      }
      parent_id = parent.id;
    }

    let code = number ?? null;
    if (code && taken.has(code)) {
      const other = existing.find(a => a.code === code);
      const given = nextCode(taken, row.account_type, detail_type);
      result.notes.push(`${row.name}: number ${code} is taken${other ? ` by ${other.name}` : ''}, so it is ${given} here`);
      code = given;
    }
    code ??= nextCode(taken, row.account_type, detail_type);
    const account = await createAccount(trx, ctx, {
      business_id, code, name: leaf, account_type: row.account_type, parent_id,
      detail_type, description: row.description?.trim() || null,
    });
    taken.add(code);
    pathToAccount.set(path, { id: account.id, account_type: row.account_type });
    records.push({ entity_type: 'account', entity_id: account.id });
    created++;
  }

  result.counts = { created, already_here: matched };
  if (result.problems.length === 0 && records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'accounts', cutover_date: input.cutover_date, file_name: input.file_name ?? null,
      summary: { created, already_here: matched }, records,
    });
  }
  return result;
}

type Address = Partial<Record<'line1' | 'line2' | 'city' | 'state' | 'postal_code' | 'country', string | undefined>> | null | undefined;
const cleanAddress = (a: Address) => {
  if (!a) return null;
  const entries = Object.entries(a).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  return entries.length > 0 ? Object.fromEntries(entries.map(([k, v]) => [k, (v as string).trim()])) : null;
};
const orNull = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);

export async function importCustomers(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbCustomersImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'customers', input.cutover_date, false));
  const existing = await trx.selectFrom('customers').select('name').where('business_id', '=', business_id).where('deleted_at', 'is', null).execute();
  const names = new Set(existing.map(c => norm(c.name)));
  const records: QbRecord[] = [];
  let skipped = 0;
  for (const row of input.rows) {
    if (names.has(norm(row.name))) { skipped++; continue; }
    names.add(norm(row.name));
    const customer = await createCustomer(trx, ctx, {
      business_id, name: row.name.trim(),
      company_name: orNull(row.company_name), email: orNull(row.email), phone: orNull(row.phone),
      billing_address: cleanAddress(row.billing_address), notes: orNull(row.notes),
      ...(row.terms_days != null ? { default_terms_days: row.terms_days } : {}),
    });
    records.push({ entity_type: 'customer', entity_id: customer.id });
  }
  if (skipped > 0) result.notes.push(`${skipped} already here by name, left as they are`);
  result.counts = { created: records.length, already_here: skipped };
  if (result.problems.length === 0 && records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'customers', cutover_date: input.cutover_date, file_name: input.file_name ?? null, summary: result.counts, records,
    });
  }
  return result;
}

export async function importVendors(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbVendorsImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'vendors', input.cutover_date, false));
  const existing = await trx.selectFrom('vendors').select('name').where('business_id', '=', business_id).where('deleted_at', 'is', null).execute();
  const names = new Set(existing.map(v => norm(v.name)));
  const records: QbRecord[] = [];
  let skipped = 0;
  for (const row of input.rows) {
    if (names.has(norm(row.name))) { skipped++; continue; }
    names.add(norm(row.name));
    const vendor = await createVendor(trx, ctx, {
      business_id, name: row.name.trim(),
      company_name: orNull(row.company_name), email: orNull(row.email), phone: orNull(row.phone),
      billing_address: cleanAddress(row.billing_address), account_number: orNull(row.account_number), notes: orNull(row.notes),
      ...(row.terms_days != null ? { default_terms_days: row.terms_days } : {}),
    });
    records.push({ entity_type: 'vendor', entity_id: vendor.id });
  }
  if (skipped > 0) result.notes.push(`${skipped} already here by name, left as they are`);
  result.counts = { created: records.length, already_here: skipped };
  if (result.problems.length === 0 && records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'vendors', cutover_date: input.cutover_date, file_name: input.file_name ?? null, summary: result.counts, records,
    });
  }
  return result;
}

export async function importItems(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbItemsImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  const withStock = input.rows.some(r => r.quantity_on_hand && !isZero(r.quantity_on_hand));
  result.problems.push(...await guardProblems(trx, business_id, 'items', input.cutover_date, withStock));
  if (withStock) result.problems.push(...await dateProblems(trx, business_id, input.cutover_date, [{ row: 0, date: input.cutover_date }]));

  const match = makeAccountMatcher(await loadAccounts(trx, business_id));
  const existing = await trx.selectFrom('inventory_items').select(['name', 'sku'])
    .where('business_id', '=', business_id).where('deleted_at', 'is', null).execute();
  const names = new Set(existing.map(i => norm(i.name)));
  const skus = new Set(existing.map(i => norm(i.sku)));

  const account = (i: number, label: string | null | undefined, expected: string, what: string): string | null => {
    if (!label || label.trim() === '') return null;
    const m = match(label);
    if ('error' in m) { result.problems.push({ row: i, message: m.error }); return null; }
    if (m.account.account_type !== expected) {
      result.problems.push({ row: i, message: `${what} "${label}" is not ${TYPE_LABEL[expected]} account` });
      return null;
    }
    return m.account.id;
  };

  const records: QbRecord[] = [];
  let skipped = 0;
  let noIncome = 0;
  for (const [i, row] of input.rows.entries()) {
    if (names.has(norm(row.name))) { skipped++; continue; }
    names.add(norm(row.name));
    const income_account_id = account(i, row.income_account, 'revenue', 'Income account');
    const expense_account_id = account(i, row.expense_account, 'expense', 'Expense account');
    const inventory_asset_account_id = account(i, row.inventory_asset_account, 'asset', 'Inventory asset account');
    if (result.problems.length > 0) continue;
    if (!income_account_id) noIncome++;
    // QuickBooks doesn't need a SKU; the app does, one to an item.
    let sku = row.sku?.trim() || row.name.trim();
    for (let n = 2; skus.has(norm(sku)); n++) sku = `${row.sku?.trim() || row.name.trim()} (${n})`;
    skus.add(norm(sku));
    const item = await createItem(trx, ctx, {
      business_id, sku, name: row.name.trim(), description: orNull(row.description), unit_of_measure: 'each',
      purchase_cost: row.purchase_cost ? toMoneyString(row.purchase_cost) : null,
      sale_price: row.sale_price ? toMoneyString(row.sale_price) : null,
      income_account_id, expense_account_id, inventory_asset_account_id,
    });
    records.push({ entity_type: 'inventory_item', entity_id: item.id });
    if (row.quantity_on_hand && !isZero(row.quantity_on_hand)) {
      const movement = await adjustStock(trx, ctx, {
        business_id, item_id: item.id, movement_date: input.cutover_date, quantity_delta: row.quantity_on_hand,
        reason: 'opening_balance', memo: 'Opening stock from QuickBooks', unit_cost: row.purchase_cost ?? '0',
      });
      records.push({ entity_type: 'stock_movement', entity_id: movement.id });
    }
  }
  if (skipped > 0) result.notes.push(`${skipped} already here by name, left as they are`);
  if (noIncome > 0) result.notes.push(`${noIncome} have no income account, so they can't go on an invoice until one is set`);
  result.counts = { created: records.filter(r => r.entity_type === 'inventory_item').length, with_stock: records.filter(r => r.entity_type === 'stock_movement').length, already_here: skipped };
  if (result.problems.length === 0 && records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'items', cutover_date: input.cutover_date, file_name: input.file_name ?? null, summary: result.counts, records,
    });
  }
  return result;
}
