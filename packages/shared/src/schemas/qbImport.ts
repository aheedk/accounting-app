import { z } from 'zod';

// Moving a client from QuickBooks: each step's upload, after the web page has
// read QuickBooks' export into rows. Names (accounts, customers, vendors) are
// QuickBooks' own; the API matches them to this company's records.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();

const base = {
  cutover_date: dateString,
  file_name: optionalText(255),
};

const address = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  postal_code: z.string().max(20).optional(),
  country: z.string().max(80).optional(),
}).nullable().optional();

export const qbAccountsImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    /** QuickBooks' full name: a sub-account is `Parent:Child`. */
    name: text(300).min(1),
    number: optionalText(20),
    account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    detail_type: optionalText(100),
    description: optionalText(500),
  })).min(1).max(5000),
});

export const qbCustomersImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    name: text(200).min(1),
    company_name: optionalText(200),
    email: optionalText(254),
    phone: optionalText(40),
    billing_address: address,
    terms_days: z.number().int().min(0).max(365).nullable().optional(),
    notes: optionalText(2000),
  })).min(1).max(20000),
});

export const qbVendorsImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    name: text(200).min(1),
    company_name: optionalText(200),
    email: optionalText(254),
    phone: optionalText(40),
    billing_address: address,
    terms_days: z.number().int().min(0).max(365).nullable().optional(),
    account_number: optionalText(100),
    notes: optionalText(2000),
  })).min(1).max(20000),
});

export const qbItemsImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    name: text(200).min(1),
    sku: optionalText(100),
    description: optionalText(1000),
    sale_price: moneyStr.nullable().optional(),
    purchase_cost: moneyStr.nullable().optional(),
    income_account: optionalText(300),
    expense_account: optionalText(300),
    inventory_asset_account: optionalText(300),
    quantity_on_hand: moneyStr.nullable().optional(),
  })).min(1).max(20000),
});

export const qbOpenInvoicesImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    customer: text(200).min(1),
    /** QuickBooks' transaction type: Invoice, Credit Memo, Payment... */
    type: text(60).min(1),
    date: dateString,
    number: optionalText(50),
    due_date: dateString.nullable().optional(),
    terms: optionalText(60),
    /** What is still open. Negative for money the customer has on account. */
    amount: moneyStr,
  })).min(1).max(20000),
});

export const qbOpenBillsImportSchema = z.object({
  ...base,
  rows: z.array(z.object({
    vendor: text(200).min(1),
    type: text(60).min(1),
    date: dateString,
    number: optionalText(50),
    due_date: dateString.nullable().optional(),
    terms: optionalText(60),
    /** What is still owed. Negative for a credit the vendor has given. */
    amount: moneyStr,
  })).min(1).max(20000),
});

export const qbUnclearedImportSchema = z.object({
  ...base,
  /** The bank or credit card account, by QuickBooks' name. */
  account: text(300).min(1),
  rows: z.array(z.object({
    date: dateString,
    type: optionalText(60),
    number: optionalText(50),
    name: optionalText(200),
    memo: optionalText(500),
    /** Positive for money into the account (a deposit, a card payment), negative for money out. */
    amount: moneyStr,
  })).max(20000),
});

export const qbTrialBalanceImportSchema = z.object({
  ...base,
  lines: z.array(z.object({
    account: text(300).min(1),
    debit: moneyStr,
    credit: moneyStr,
  })).min(1).max(5000),
});

export const qbHistoryImportSchema = z.object({
  ...base,
  transactions: z.array(z.object({
    date: dateString,
    type: optionalText(60),
    number: optionalText(50),
    name: optionalText(200),
    memo: optionalText(500),
    lines: z.array(z.object({
      account: text(300).min(1),
      debit: moneyStr,
      credit: moneyStr,
      memo: optionalText(500),
      name: optionalText(200),
    })).min(1).max(1000),
  })).min(1).max(100000),
});

export type QbAccountsImport = z.infer<typeof qbAccountsImportSchema>;
export type QbCustomersImport = z.infer<typeof qbCustomersImportSchema>;
export type QbVendorsImport = z.infer<typeof qbVendorsImportSchema>;
export type QbItemsImport = z.infer<typeof qbItemsImportSchema>;
export type QbOpenInvoicesImport = z.infer<typeof qbOpenInvoicesImportSchema>;
export type QbOpenBillsImport = z.infer<typeof qbOpenBillsImportSchema>;
export type QbUnclearedImport = z.infer<typeof qbUnclearedImportSchema>;
export type QbTrialBalanceImport = z.infer<typeof qbTrialBalanceImportSchema>;
export type QbHistoryImport = z.infer<typeof qbHistoryImportSchema>;
