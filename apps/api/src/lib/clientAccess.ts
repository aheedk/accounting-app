/**
 * What the `client` role may do inside a business.
 *
 * A client sees their own company's financial reports, invoices and bills, can
 * send documents to the firm, and can write to it. Nothing else. (The original
 * design, docs/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md,
 * "Role hierarchy", gave reports and invoices; the rest was added on 2026-10-08,
 * docs/specs/2026-10-08-accounts-and-roles-design.md.) Reads were never guarded
 * route by route, so a client could open payroll, bank lines and the AI inbox.
 * Rather than guard every other route, the tenancy middleware refuses a client
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
  /^\/bills$/,                                                                 // what they owe, bill by bill
  new RegExp(`^/bills/${ID}$`),
  /^\/vendors$/,                                                               // who each bill is from
  new RegExp(`^/vendors/${ID}$`),
  /^\/messages$/,                                                              // the thread with the firm
  /^\/messages\/unread-count$/,
];

// The only things a client changes: a document sent in for the firm to review
// (it reaches the books only when an accountant approves it), and the thread.
const CLIENT_WRITES: RegExp[] = [
  /^\/ai\/documents$/,
  /^\/messages$/,
  /^\/messages\/read$/,
];

/** `pathInBusiness` is `req.path` inside a router mounted on `/businesses/:businessId`. */
export function clientMayRequest(method: string, pathInBusiness: string): boolean {
  const path = pathInBusiness.length > 1 ? pathInBusiness.replace(/\/+$/, '') : '/';
  const verb = method.toUpperCase();
  if (verb === 'GET') return CLIENT_READS.some(pattern => pattern.test(path));
  if (verb === 'POST') return CLIENT_WRITES.some(pattern => pattern.test(path));
  return false;
}
