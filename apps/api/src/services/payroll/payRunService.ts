import { sql, type Transaction, type Kysely } from 'kysely';
import {
  AUDIT,
  ERR,
  addMoney,
  subMoney,
  toMoneyString,
} from '@accounting/shared';
import type { DB, PayRunStatus } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type PayRunLineInput = {
  employee_id: string;
  gross: string;
  federal_wh?: string;
  state_wh?: string;
  fica_employee?: string;
  fica_employer?: string;
  medicare_employee?: string;
  medicare_employer?: string;
  other_deductions?: string;
};

export type CreatePayRunInput = {
  business_id: string;
  pay_period_start: string;
  pay_period_end: string;
  pay_date: string;
  memo?: string | null;
  accounts: {
    wages_expense: string;
    payroll_tax_expense: string;
    cash: string;
    fed_tax_liability: string;
    state_tax_liability?: string | null;
    fica_liability: string;
  };
  lines: PayRunLineInput[];
};

function n(v: string | undefined): string {
  return v ?? '0';
}

function computeNet(line: PayRunLineInput): string {
  const deductions = addMoney(
    addMoney(addMoney(n(line.federal_wh), n(line.state_wh)), n(line.fica_employee)),
    addMoney(n(line.medicare_employee), n(line.other_deductions)),
  );
  return toMoneyString(subMoney(line.gross, deductions));
}

export async function createDraft(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreatePayRunInput,
) {
  if (input.lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'pay run must have at least one line');
  }

  // Build values conditionally so exactOptionalPropertyTypes does not see `undefined` keys.
  const values: {
    business_id: string;
    pay_period_start: string;
    pay_period_end: string;
    pay_date: string;
    memo: string | null;
    wages_expense_account_id: string;
    payroll_tax_expense_account_id: string;
    cash_account_id: string;
    fed_tax_liability_account_id: string;
    state_tax_liability_account_id?: string | null;
    fica_liability_account_id: string;
    created_by_user_id: string;
  } = {
    business_id: input.business_id,
    pay_period_start: input.pay_period_start,
    pay_period_end: input.pay_period_end,
    pay_date: input.pay_date,
    memo: input.memo ?? null,
    wages_expense_account_id: input.accounts.wages_expense,
    payroll_tax_expense_account_id: input.accounts.payroll_tax_expense,
    cash_account_id: input.accounts.cash,
    fed_tax_liability_account_id: input.accounts.fed_tax_liability,
    fica_liability_account_id: input.accounts.fica_liability,
    created_by_user_id: ctx.user_id,
  };
  if (input.accounts.state_tax_liability !== undefined) {
    values.state_tax_liability_account_id = input.accounts.state_tax_liability ?? null;
  }

  const run = await trx.insertInto('pay_runs').values(values).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('pay_run_lines').values(
    input.lines.map(l => ({
      pay_run_id: run.id,
      employee_id: l.employee_id,
      gross: l.gross,
      federal_wh: n(l.federal_wh),
      state_wh: n(l.state_wh),
      fica_employee: n(l.fica_employee),
      fica_employer: n(l.fica_employer),
      medicare_employee: n(l.medicare_employee),
      medicare_employer: n(l.medicare_employer),
      other_deductions: n(l.other_deductions),
      net: computeNet(l),
    })),
  ).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.PAY_RUN_CREATE,
    entity_type: 'pay_run',
    entity_id: run.id,
    before: null,
    after: run,
  });
  return run;
}

export async function finalize(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { pay_run_id: string },
) {
  const run = await trx.selectFrom('pay_runs').selectAll()
    .where('id', '=', input.pay_run_id).executeTakeFirst();
  if (!run) throw new NotFoundError('pay_run', input.pay_run_id);
  if (run.status !== 'draft') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `pay run is ${run.status}, not draft`);
  }

  const lines = await trx.selectFrom('pay_run_lines').selectAll()
    .where('pay_run_id', '=', input.pay_run_id).execute();
  if (lines.length === 0) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'pay run has no lines');
  }

  // Reduce columns to Decimals; convert to strings via toMoneyString at JE construction.
  type NumericLineKey =
    | 'gross' | 'net' | 'federal_wh' | 'state_wh'
    | 'fica_employee' | 'fica_employer'
    | 'medicare_employee' | 'medicare_employer'
    | 'other_deductions';
  const sumOf = (k: NumericLineKey) =>
    lines.reduce<ReturnType<typeof addMoney>>(
      (acc, l) => addMoney(acc, String(l[k])),
      addMoney('0', '0'),
    );

  const totalGross = sumOf('gross');
  const totalNet = sumOf('net');
  const totalFedWH = sumOf('federal_wh');
  const totalStateWH = sumOf('state_wh');
  const totalFicaEmp = sumOf('fica_employee');
  const totalFicaEmpr = sumOf('fica_employer');
  const totalMedEmp = sumOf('medicare_employee');
  const totalMedEmpr = sumOf('medicare_employer');
  const totalEmployerTax = addMoney(totalFicaEmpr, totalMedEmpr);
  const totalFicaLiability = addMoney(
    addMoney(totalFicaEmp, totalFicaEmpr),
    addMoney(totalMedEmp, totalMedEmpr),
  );

  // Build candidate JE lines, then drop any with both debit and credit = 0 — the ledger
  // rejects such "empty" lines. Pay runs with no employer-tax burden or no state WH
  // will simply omit those legs from the JE.
  const candidates: Array<{ account_id: string; debit: string; credit: string; memo: string | null }> = [
    { account_id: run.wages_expense_account_id, debit: toMoneyString(totalGross), credit: '0', memo: null },
    { account_id: run.payroll_tax_expense_account_id, debit: toMoneyString(totalEmployerTax), credit: '0', memo: null },
    { account_id: run.cash_account_id, debit: '0', credit: toMoneyString(totalNet), memo: null },
    { account_id: run.fed_tax_liability_account_id, debit: '0', credit: toMoneyString(totalFedWH), memo: null },
    { account_id: run.fica_liability_account_id, debit: '0', credit: toMoneyString(totalFicaLiability), memo: null },
  ];
  if (run.state_tax_liability_account_id) {
    candidates.push({
      account_id: run.state_tax_liability_account_id,
      debit: '0',
      credit: toMoneyString(totalStateWH),
      memo: null,
    });
  } else if (Number(toMoneyString(totalStateWH)) > 0) {
    throw new BusinessRuleError(
      ERR.PRECONDITION_FAILED,
      'state withholding present but no state_tax_liability_account_id set',
    );
  }
  const jeLines = candidates.filter(
    l => Number(l.debit) > 0 || Number(l.credit) > 0,
  );

  const je = await postJournalEntry(trx, ctx, {
    business_id: run.business_id,
    entry_date: run.pay_date,
    source_type: 'manual',
    memo: run.memo ?? `Pay run ${run.pay_period_start}-${run.pay_period_end}`,
    reference: null,
    lines: jeLines,
  });

  const updated = await trx.updateTable('pay_runs').set({
    status: 'finalized',
    journal_entry_id: je.id,
    finalized_at: sql`now()`,
    finalized_by_user_id: ctx.user_id,
  }).where('id', '=', input.pay_run_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.PAY_RUN_FINALIZE,
    entity_type: 'pay_run',
    entity_id: updated.id,
    before: run,
    after: updated,
  });
  return updated;
}

export async function voidPayRun(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { pay_run_id: string; void_reason?: string },
) {
  const before = await trx.selectFrom('pay_runs').selectAll()
    .where('id', '=', input.pay_run_id).executeTakeFirst();
  if (!before) throw new NotFoundError('pay_run', input.pay_run_id);
  if (before.status === 'void') throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'already void');

  if (before.status === 'finalized' && before.journal_entry_id) {
    await voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: input.void_reason ?? 'pay run voided',
    });
  }

  // Migration 0051 loosened pr_finalized_has_je to a one-way implication so
  // void is allowed to keep journal_entry_id / finalized_at. Preserving them
  // maintains the direct audit back-link to the reversed JE on the pay_run row.
  const updated = await trx.updateTable('pay_runs').set({
    status: 'void',
  }).where('id', '=', input.pay_run_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.PAY_RUN_VOID,
    entity_type: 'pay_run',
    entity_id: updated.id,
    before,
    after: updated,
  });
  return updated;
}

export async function listPayRuns(
  db: Kysely<DB>,
  business_id: string,
  opts: { status?: PayRunStatus } = {},
) {
  let q = db.selectFrom('pay_runs').selectAll().where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('pay_date', 'desc').execute();
}

export async function getPayRunWithLines(db: Kysely<DB>, business_id: string, id: string) {
  const run = await db.selectFrom('pay_runs').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!run) throw new NotFoundError('pay_run', id);
  const lines = await db.selectFrom('pay_run_lines').selectAll()
    .where('pay_run_id', '=', id).execute();
  return { ...run, lines };
}
