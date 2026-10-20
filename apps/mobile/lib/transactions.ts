// transactionsService.ts's total_amount is an unsigned magnitude (the
// document's own face total) for every type, not a signed +in/-out figure
// like the reconciliation worksheet's amount field — direction has to come
// from the type, not the number's sign.
const INFLOW_TYPES = new Set(['deposit', 'payment', 'credit_memo', 'invoice']);

export function isInflowType(type: string): boolean {
  return INFLOW_TYPES.has(type);
}
