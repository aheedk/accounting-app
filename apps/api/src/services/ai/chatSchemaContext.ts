import type { Kysely } from 'kysely';
import type { DB } from '../../db/types.js';

/**
 * Plain-text table/column descriptions for the 11 schema areas the chat
 * feature can query — no data, just structure, so the LLM can write SQL
 * against real column names. Hand-written from the actual Kysely table
 * interfaces in db/types.ts (not generated), so it needs updating by hand if
 * one of these tables' columns change — same maintenance cost as
 * gmailWorker.ts's buildCoaPromptSection, which is also hand-maintained
 * prompt text, not introspected from the schema at runtime.
 */
export function buildSchemaContext(): string {
  return `
chart_of_accounts — the chart of accounts
  id uuid, business_id uuid, code text, name text,
  account_type text (asset|liability|equity|revenue|expense), detail_type text,
  is_active boolean

journal_entries — every posted/voided manual and system journal entry (the general ledger's header rows)
  id uuid, business_id uuid, period_id uuid, entry_date date, journal_number text,
  memo text, reference text, status text (draft|posted|voided),
  source_type text (manual|expense|invoice|bill|payment|...), payee_name text

journal_entry_lines — the debit/credit lines of a journal entry; every posted transaction in the ledger ultimately has lines here
  id uuid, journal_entry_id uuid, line_number int, account_id uuid,
  debit numeric, credit numeric, memo text, name text, class_name text

invoices — AR invoices
  id uuid, business_id uuid, customer_id uuid, invoice_number text,
  issue_date date, due_date date, status text (draft|posted|voided|paid),
  subtotal numeric, tax_total numeric, total numeric, memo text

invoice_lines — invoice line items
  id uuid, invoice_id uuid, line_number int, description text,
  quantity numeric, unit_price numeric, revenue_account_id uuid,
  line_subtotal numeric, tax_amount numeric, line_total numeric

bills — AP bills
  id uuid, business_id uuid, vendor_id uuid, bill_number text,
  bill_date date, due_date date, status text (draft|posted|voided),
  subtotal numeric, total numeric, memo text

bill_lines — bill line items
  id uuid, bill_id uuid, line_number int, description text,
  quantity numeric, unit_price numeric, expense_account_id uuid, line_subtotal numeric

expense_transactions — standalone expenses (not tied to a bill)
  id uuid, business_id uuid, transaction_date date, payee_text text,
  vendor_id uuid nullable, customer_id uuid nullable, payment_account_id uuid,
  payment_method text, total_amount numeric, memo text, status text (draft|posted|voided)

expense_transaction_lines — expense line items, each coded to one account
  id uuid, expense_transaction_id uuid, business_id uuid, category_account_id uuid,
  description text, amount numeric

customers — AR contacts
  id uuid, business_id uuid, name text, company_name text, email text, phone text

vendors — AP contacts
  id uuid, business_id uuid, name text, company_name text, email text, phone text

bank_transactions — bank-feed rows awaiting or already reviewed
  id uuid, business_id uuid, bank_account_id uuid, transaction_date date,
  description text, amount numeric (positive = money in, negative = money out),
  status text (unreviewed|categorized|matched|excluded), is_reconciled boolean

bank_deposits — deposit transactions (money into a bank account)
  id uuid, business_id uuid, bank_account_id uuid, deposit_date date,
  deposit_number text, memo text, total_amount numeric

bank_deposit_lines — deposit line items ("other funds" or linked undeposited-funds payments)
  id uuid, deposit_id uuid, business_id uuid, line_type text (other_funds|undeposited_funds),
  account_id uuid nullable, description text, amount numeric

payments — AR payments received from customers
  id uuid, business_id uuid, customer_id uuid, payment_date date,
  payment_method text, amount numeric, unapplied_amount numeric,
  cash_account_id uuid, status text (draft|posted|voided)

payment_applications — how a payment (or credit memo) was applied to invoices
  id uuid, payment_id uuid nullable, credit_memo_id uuid nullable,
  invoice_id uuid, applied_amount numeric

bill_payments — AP payments made to vendors
  id uuid, business_id uuid, vendor_id uuid, payment_date date,
  payment_method text, amount numeric, unapplied_amount numeric,
  cash_account_id uuid, status text (draft|posted|voided)

fiscal_periods — the business's fiscal calendar
  id uuid, business_id uuid, starts_on date, ends_on date, status text (open|closed)

Every table above has a business_id column except journal_entry_lines, invoice_lines,
bill_lines, and expense_transaction_lines/bank_deposit_lines (the latter also has one) —
join those to their parent row to scope them to one business.
`.trim();
}

type SimpleAccount = { id: string; code: string; name: string; account_type: string };

/** Live chart-of-accounts names → real ids, for fuzzy-matching an account name
 * the user typed ("rent") to the account the SQL/action payload should
 * actually reference. Same spirit as gmailWorker.ts's buildCoaPromptSection,
 * written fresh here rather than imported — that function is module-private
 * and depends on an already-fetched ClientContext this feature doesn't build. */
export async function buildCoaPromptSection(db: Kysely<DB>, businessId: string): Promise<string> {
  const accounts = await db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .orderBy('code')
    .execute() as SimpleAccount[];
  if (accounts.length === 0) return 'No active accounts found.';
  return accounts.map(a => `${a.id} | ${a.code} — ${a.name} (${a.account_type})`).join('\n');
}

/** Live customers + vendors → real ids, for fuzzy-matching a party name the
 * user typed to the real contact the action payload should reference. */
export async function buildContactsPromptSection(db: Kysely<DB>, businessId: string): Promise<string> {
  const customers = await db.selectFrom('customers')
    .select(['id', 'name'])
    .where('business_id', '=', businessId)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();
  const vendors = await db.selectFrom('vendors')
    .select(['id', 'name'])
    .where('business_id', '=', businessId)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();
  const lines = [
    ...customers.map(c => `${c.id} | ${c.name} (customer)`),
    ...vendors.map(v => `${v.id} | ${v.name} (vendor)`),
  ];
  return lines.length > 0 ? lines.join('\n') : 'No customers or vendors found.';
}
