// What is owed to a vendor, the same figure on every page: the A/P aging total,
// which is its unpaid bills less payments not yet applied and credits not yet
// used, and agrees with Accounts Payable in the ledger. Adding up bill totals in
// the browser counted a part-paid bill in full and ignored credits.

export type VendorAgingRow = { id: string; total: string };

/** Vendor id to open balance, from the rows of `/reports/ap-aging`. */
export function vendorOpenBalances(rows: readonly VendorAgingRow[]): Map<string, number> {
  return new Map(rows.map(row => [row.id, Number(row.total) || 0]));
}

/** What is still owed on one bill: its total less what has been paid or credited against it. */
export function billOpenAmount(bill: { total: string; open_balance?: string | null }): number {
  const open = bill.open_balance;
  return Number(open === undefined || open === null ? bill.total : open) || 0;
}
