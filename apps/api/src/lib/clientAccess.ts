/**
 * What the `client` role may do inside a business.
 *
 * The design gives a client a view of their own company's financial reports
 * and invoices, and nothing else (docs/specs/2026-04-20-accounting-app-slice-1-
 * ledger-and-ar-design.md, "Role hierarchy"). Reads were never guarded route by
 * route, so a client could open payroll, bank lines and the AI inbox. Rather
 * than guard every other route, the tenancy middleware refuses a client
 * anything that is not on this list. A new route is closed to clients until it
 * is added here.
 *
 * Paths are what follows `/businesses/:businessId`.
 */
const ID = '[0-9a-fA-F-]{36}';

const CLIENT_READS: RegExp[] = [
  /^\/$/,                                                                      // the business: name and address
  /^\/reports\/(pnl|balance-sheet|statement-of-cash-flows|trial-balance|aging|ap-aging)$/,
  /^\/csv-exports\/trial-balance$/,
  /^\/invoices$/,
  new RegExp(`^/invoices/${ID}$`),
  /^\/customers$/,                                                             // who each invoice is to
  new RegExp(`^/customers/${ID}$`),
];

/** `pathInBusiness` is `req.path` inside a router mounted on `/businesses/:businessId`. */
export function clientMayRequest(method: string, pathInBusiness: string): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  const path = pathInBusiness.length > 1 ? pathInBusiness.replace(/\/+$/, '') : '/';
  return CLIENT_READS.some(pattern => pattern.test(path));
}
