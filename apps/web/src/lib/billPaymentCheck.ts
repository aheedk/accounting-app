import type { CheckDocInput } from './download';
import { fmtDateText } from './dates';
import { fmtMoney } from './money';

type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };

export type CheckVendor = {
  name: string;
  name_on_checks?: string | null;
  billing_address?: Address | null;
};

export type PaidBill = { bill_number: string; due_date?: string | null; amount: string };

function addressLines(a: Address | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine].filter((line): line is string => Boolean(line));
}

/**
 * The check for one bill payment: made out to the vendor (the name it wants on
 * checks, when it has one), with the bills it pays listed on the stub.
 */
export function billPaymentCheck(args: {
  checkNumber: string | null;
  paymentDate: string;
  vendor: CheckVendor;
  amount: string;
  bills: PaidBill[];
  bankAccountName: string;
  bankAccountLastFour?: string | null;
  memo?: string | null;
  businessName: string;
}): CheckDocInput {
  const payee = args.vendor.name_on_checks?.trim() || args.vendor.name;
  return {
    checkNumber: args.checkNumber?.trim() || '—',
    paymentDate: fmtDateText(args.paymentDate.slice(0, 10)),
    payeeName: payee,
    mailingAddress: [payee, ...addressLines(args.vendor.billing_address)],
    amount: fmtMoney(args.amount),
    bankAccountName: args.bankAccountName,
    bankAccountLastFour: args.bankAccountLastFour ?? null,
    memo: args.memo?.trim() || null,
    lineHeaders: ['Bill no.', 'Due date', 'Amount paid'],
    lines: args.bills.map(bill => ({
      accountLabel: bill.bill_number,
      description: bill.due_date ? fmtDateText(bill.due_date.slice(0, 10)) : '',
      amount: fmtMoney(bill.amount),
    })),
    businessName: args.businessName,
  };
}
