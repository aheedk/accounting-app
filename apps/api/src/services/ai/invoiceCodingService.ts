import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import {
  normalizeVendor,
  normalizeLineKey,
  isCapitalizable,
  confidenceBand,
  DEFAULT_CAPITALIZATION_THRESHOLD,
  ERR,
} from '@accounting/shared';
import { BusinessRuleError } from '../../lib/errors.js';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import type { Suggestion, SuggestionLine } from './autoCodingService.js';

/**
 * Auto-coding for invoice and bill LINE items.
 *
 * Sibling to autoCodingService, not a reuse of it. A bank transaction has one
 * vendor and one account, so the vendor is the whole signal. An invoice has one
 * known vendor and many lines that belong in different accounts, so the line
 * itself is the signal and rules are keyed on vendor + line.
 *
 * Layers, first hit wins:
 *   1 learned rule for this vendor + line   99
 *   2 capitalization rule                   96
 *   3 vendor default account                90
 *   4 how prior bills from this vendor were coded  70-92
 *   5 the extraction model's proposal       85
 */

export type InvoiceLineInput = {
  description: string;
  /** Line total, positive. */
  amount: string;
  /** Account name the extraction model proposed, if any. */
  ai_suggested_account?: string | null;
};

export type InvoiceCodingContext = {
  accounts: Array<{ id: string; code: string; name: string; account_type: string; detail_type: string | null }>;
  accountIds: Set<string>;
  /** normalized line key -> split template, for this vendor. */
  learned: Map<string, SuggestionLine[]>;
  vendorDefaultAccountId: string | null;
  /** normalized line key -> account id -> times coded that way. */
  history: Map<string, Map<string, number>>;
  capitalizationThreshold: number;
};

/** Upper bound on prior bill lines scanned per invoice (layer 4). */
const HISTORY_SCAN_LIMIT = 2000;

function requireBusiness(ctx: ServiceCtx): string {
  if (!ctx.business_id) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  return ctx.business_id;
}

/**
 * Load everything the layers need for one vendor's invoice, once.
 *
 * `vendorName` is the vendor as extracted from the document; it is normalized
 * here so it lines up with the bank-side vendor keys.
 */
export async function loadInvoiceCodingContext(
  db: Kysely<DB> | Transaction<DB>,
  ctx: ServiceCtx,
  vendorName: string | null,
): Promise<InvoiceCodingContext> {
  const businessId = requireBusiness(ctx);
  const vendor = normalizeVendor(vendorName ?? '');

  const accounts = await db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type', 'detail_type'])
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .where('is_locked', '=', false)
    .execute();
  const accountIds = new Set(accounts.map(a => a.id));

  const business = await db.selectFrom('businesses')
    .select(['capitalization_threshold'])
    .where('id', '=', businessId)
    .executeTakeFirst();
  const capitalizationThreshold = Number(business?.capitalization_threshold ?? DEFAULT_CAPITALIZATION_THRESHOLD);

  const learned = new Map<string, SuggestionLine[]>();
  let vendorDefaultAccountId: string | null = null;
  const history = new Map<string, Map<string, number>>();

  if (vendor) {
    const memoryRows = await db.selectFrom('account_coding_memory')
      .select(['line_key', 'lines'])
      .where('business_id', '=', businessId)
      .where('normalized_vendor', '=', vendor)
      .where('direction', '=', 'debit')
      .where('line_key', '!=', '')
      .execute();
    for (const row of memoryRows) {
      learned.set(row.line_key, row.lines as unknown as SuggestionLine[]);
    }

    const vendorRow = await db.selectFrom('vendors')
      .select(['default_expense_account_id'])
      .where('business_id', '=', businessId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`lower(name) = ${vendor} OR lower(name) = ${(vendorName ?? '').trim().toLowerCase()}`)
      .executeTakeFirst();
    vendorDefaultAccountId = vendorRow?.default_expense_account_id ?? null;

    // Prior bills from this vendor are the training data for invoice lines,
    // the way prior bank transactions are for statements.
    const priorLines = await db.selectFrom('bill_lines as bl')
      .innerJoin('bills as b', 'b.id', 'bl.bill_id')
      .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
      .select(['bl.description', 'bl.expense_account_id'])
      .where('b.business_id', '=', businessId)
      .where('b.status', '=', 'posted')
      .where(sql<boolean>`lower(v.name) = ${vendor} OR lower(v.name) = ${(vendorName ?? '').trim().toLowerCase()}`)
      .orderBy('b.bill_date', 'desc')
      .limit(HISTORY_SCAN_LIMIT)
      .execute();

    for (const row of priorLines) {
      if (!accountIds.has(row.expense_account_id)) continue;
      const key = normalizeLineKey(row.description);
      if (!key) continue;
      let tally = history.get(key);
      if (!tally) { tally = new Map(); history.set(key, tally); }
      tally.set(row.expense_account_id, (tally.get(row.expense_account_id) ?? 0) + 1);
    }
  }

  return { accounts, accountIds, learned, vendorDefaultAccountId, history, capitalizationThreshold };
}

function debitLine(accountId: string, amount: string, memo: string | null): SuggestionLine {
  // An invoice line is always a debit to the expense/asset account; the credit
  // side is AP (or AR for a customer invoice) and is handled by the bill service.
  return { account_id: accountId, debit: amount, credit: '0.0000', memo };
}

function build(
  accountId: string,
  amount: string,
  confidence: number,
  layer: Suggestion['source_layer'],
  memo: string | null = null,
): Suggestion {
  return {
    confidence,
    source_layer: layer,
    band: confidenceBand(confidence),
    lines: [debitLine(accountId, amount, memo)],
  };
}

/** Pick the fixed-asset account that best fits a capitalized line. */
function fixedAssetAccount(
  accounts: InvoiceCodingContext['accounts'],
  description: string,
) {
  const text = description.toLowerCase();
  const preference: Array<[RegExp, RegExp]> = [
    [/desk|chair|table|furniture|cabinet|shelving|workstation|fixture/, /furniture|fixture/i],
    [/server|computer|laptop|monitor|printer|copier|scanner|camera|projector|phone system/, /computer|equipment|technology|hardware/i],
    [/vehicle|truck|van|trailer/, /vehicle|auto/i],
    [/leasehold|renovation|remodel|build-?out/, /leasehold|improvement/i],
    [/hvac|air conditioner|furnace|boiler|roof/, /building|improvement|equipment/i],
  ];
  for (const [lineMatch, accountMatch] of preference) {
    if (!lineMatch.test(text)) continue;
    const match = accounts.find(a => a.account_type === 'asset' && accountMatch.test(a.name));
    if (match) return match;
  }
  // Fall back to any general fixed-asset account.
  return accounts.find(a => a.account_type === 'asset' && /equipment|fixed asset|property/i.test(a.name));
}

export function suggestInvoiceLineFromContext(
  context: InvoiceCodingContext,
  input: InvoiceLineInput,
): Suggestion | null {
  const { accounts, accountIds } = context;
  const amount = input.amount;
  const key = normalizeLineKey(input.description);

  // --- Layer 1: learned rule for this vendor + line ------------------------
  if (key) {
    const lines = context.learned.get(key);
    if (lines && lines.length > 0 && lines.every(l => accountIds.has(l.account_id))) {
      const applied = lines.length === 1
        ? [debitLine(lines[0]!.account_id, amount, lines[0]!.memo)]
        : lines;
      return { confidence: 99, source_layer: 'learned_rule', band: confidenceBand(99), lines: applied };
    }
  }

  // --- Layer 2: capitalization -------------------------------------------
  // Expensing a long-lived asset misstates both the P&L and the balance sheet,
  // so this is decided by rule rather than left to the model.
  if (isCapitalizable(input.description, Number(amount), context.capitalizationThreshold)) {
    const asset = fixedAssetAccount(accounts, input.description);
    if (asset) {
      return build(
        asset.id, amount, 96, 'accounting_rule',
        `Capitalized: at or above the ${context.capitalizationThreshold} threshold`,
      );
    }
  }

  // --- Layer 3: vendor default account -----------------------------------
  if (context.vendorDefaultAccountId && accountIds.has(context.vendorDefaultAccountId)) {
    return build(context.vendorDefaultAccountId, amount, 90, 'vendor_default');
  }

  // --- Layer 4: how prior bills from this vendor were coded ---------------
  if (key) {
    const tally = context.history.get(key);
    if (tally && tally.size > 0) {
      let total = 0;
      for (const count of tally.values()) total += count;
      const [topAccount, hits] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
      return build(topAccount, amount, Math.round(70 + (hits / total) * 22), 'history');
    }
  }

  // --- Layer 5: the extraction model's proposal ---------------------------
  if (input.ai_suggested_account) {
    const wanted = input.ai_suggested_account.trim().toLowerCase();
    const match = accounts.find(a =>
      a.name.toLowerCase() === wanted
      || `${a.code} ${a.name}`.toLowerCase() === wanted
      || a.code.toLowerCase() === wanted);
    if (match) return build(match.id, amount, 85, 'ai');
  }

  return null;
}

/** Resolve every line of one invoice against a single loaded context. */
export async function suggestInvoiceLines(
  db: Kysely<DB> | Transaction<DB>,
  ctx: ServiceCtx,
  vendorName: string | null,
  lines: InvoiceLineInput[],
): Promise<Array<Suggestion | null>> {
  if (lines.length === 0) return [];
  const context = await loadInvoiceCodingContext(db, ctx, vendorName);
  return lines.map(line => suggestInvoiceLineFromContext(context, line));
}

/**
 * Remember how an accountant coded one invoice line, keyed on vendor + line so
 * a multi-line bill can teach several different accounts.
 */
export async function rememberInvoiceLineCoding(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: {
    vendor_name: string | null;
    description: string;
    account_id: string;
    amount: string;
    was_correction: boolean;
  },
): Promise<void> {
  const businessId = requireBusiness(ctx);
  const vendor = normalizeVendor(input.vendor_name ?? '');
  const key = normalizeLineKey(input.description);
  if (!vendor || !key) return;

  await trx.insertInto('account_coding_memory')
    .values({
      business_id: businessId,
      normalized_vendor: vendor,
      direction: 'debit',
      bank_account_id: null,
      line_key: key,
      lines: JSON.stringify([debitLine(input.account_id, input.amount, null)]),
      times_applied: 1,
      times_corrected: input.was_correction ? 1 : 0,
      last_applied_at: sql`now()`,
      created_by_user_id: ctx.user_id,
    })
    .onConflict(oc => oc
      .columns(['business_id', 'normalized_vendor', 'direction', 'line_key'])
      .where('bank_account_id', 'is', null)
      .doUpdateSet({
        lines: JSON.stringify([debitLine(input.account_id, input.amount, null)]),
        times_applied: sql`account_coding_memory.times_applied + 1`,
        times_corrected: sql`account_coding_memory.times_corrected + ${input.was_correction ? 1 : 0}`,
        last_applied_at: sql`now()`,
      }))
    .execute();
}
