// A vendor's open balance comes from the server (vendorService.listVendors):
// unpaid bills less payments not yet applied and credits not yet used. Adding
// up bill totals in the browser counted a part-paid bill in full and ignored
// credits. What is left here is the same rule for one bill.

/** What is still owed on one bill: its total less what has been paid or credited against it. */
export function billOpenAmount(bill: { total: string; open_balance?: string | null }): number {
  const open = bill.open_balance;
  return Number(open === undefined || open === null ? bill.total : open) || 0;
}
