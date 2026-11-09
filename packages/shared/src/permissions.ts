import type { Role } from './roles.js';

// Custom roles: a firm admin's own roles, set area by area.
// Spec: docs/specs/2026-11-09-custom-roles-design.md
//
// Every level above "none" is one of the built-in tiers, so a request from a
// custom role is checked by the route's own guard as the built-in role of the
// level it has in the request's area. The API (middleware/tenancy.ts) and the
// web app (lib/roleAccess.ts) both place a path in an area with the lists below.

export const AREAS = [
  'sales', 'purchases', 'banking', 'accounting', 'payroll',
  'inventory', 'reports', 'documents', 'company', 'messages',
] as const;
export type Area = (typeof AREAS)[number];

export const LEVELS = ['none', 'view', 'enter', 'post', 'full'] as const;
export type Level = (typeof LEVELS)[number];

export type Permissions = Record<Area, Level>;

export const AREA_INFO: Record<Area, { label: string; covers: string }> = {
  sales: { label: 'Sales', covers: 'Invoices, estimates, payments received, credit memos and customers.' },
  purchases: { label: 'Expenses & bills', covers: 'Bills, bill payments, vendor credits, expenses, checks, vendors and contractors.' },
  banking: { label: 'Banking', covers: 'Bank accounts, bank lines and imports, rules, deposits, transfers and reconciliation.' },
  accounting: { label: 'Accounting', covers: 'Journal entries, chart of accounts, periods, fixed assets, recurring, budgets, cost centers and approvals.' },
  payroll: { label: 'Payroll', covers: 'Employees, pay runs, payroll taxes, compliance and check stubs. The Payroll tick box on Users must be on too.' },
  inventory: { label: 'Inventory', covers: 'Items, item receipts, purchase and sales orders, and shipping labels.' },
  reports: { label: 'Reports', covers: 'Every report, custom reports and exports.' },
  documents: { label: 'AI & documents', covers: 'The AI inbox, coding rules, Suspense, email and invoice imports, and the AI chat. Post here records what the inbox coded.' },
  company: { label: 'Company & activity', covers: 'Company settings, tax codes, the activity log and the QuickBooks import.' },
  messages: { label: 'Messages', covers: 'The message thread with the client.' },
};

export const LEVEL_INFO: Record<Level, { label: string; means: string }> = {
  none: { label: 'No access', means: 'Not on the menu; every call refused.' },
  view: { label: 'View', means: 'Read only, as View only does.' },
  enter: { label: 'Enter', means: 'Data entry, as Staff does. Entries wait for approval where the company asks.' },
  post: { label: 'Post', means: 'Also post, void, approve, close and reconcile, as an Accountant does.' },
  full: { label: 'Full', means: 'Also delete, settings, revealing a tax id or SSN, as a Firm admin does in that area.' },
};

/** The built-in role each level is, inside its area. */
export const LEVEL_ROLE: Record<Exclude<Level, 'none'>, Role> = {
  view: 'viewer',
  enter: 'staff',
  post: 'accountant',
  full: 'firm_admin',
};

const ROLE_LEVEL: Partial<Record<Role, Exclude<Level, 'none'>>> = {
  viewer: 'view',
  staff: 'enter',
  accountant: 'post',
  firm_admin: 'full',
};

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

/** What a built-in role amounts to, area by area. Null for a client, which is not built from areas. */
export function builtInPermissions(role: Role): Permissions | null {
  const level = ROLE_LEVEL[role];
  if (!level) return null;
  return Object.fromEntries(AREAS.map(area => [area, level])) as Permissions;
}

/** The highest level a role has anywhere. */
export function highestLevel(permissions: Permissions): Level {
  return AREAS.reduce<Level>((top, area) => (levelRank(permissions[area]) > levelRank(top) ? permissions[area] : top), 'none');
}

/** Fills areas missing from a stored role (one saved before an area existed) with "none". */
export function normalizePermissions(raw: unknown): Permissions {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(AREAS.map(area => {
    const value = source[area];
    return [area, typeof value === 'string' && (LEVELS as readonly string[]).includes(value) ? value : 'none'];
  })) as Permissions;
}

// ---------------------------------------------------------------------------
// Where an API path belongs. Paths are what follows `/businesses/:businessId`.

/**
 * - `area`: the level in that area decides.
 * - `lookup`: a list a form in any area needs (accounts, customers, items...):
 *   open, read only, to any role with any access.
 * - `attachments`: files and receipts, at the role's highest level, capped at
 *   Enter, so whoever can enter something can attach its PDF.
 * - `all`: reads across these areas (the AI chat); the lowest of them decides.
 */
export type ApiPlace =
  | { kind: 'area'; area: Area }
  | { kind: 'lookup' }
  | { kind: 'attachments' }
  | { kind: 'all'; areas: Area[] };

// The list reads forms in every area use. Only the lists, not one record's page.
const LOOKUP_READS = new Set([
  '/', '/coa', '/customers', '/vendors', '/inventory-items', '/tax-codes',
  '/cost-centers', '/bank-accounts', '/periods', '/search',
]);

const API_SEGMENT_AREA: Record<string, Area> = {
  // Sales
  invoices: 'sales', estimates: 'sales', payments: 'sales', 'credit-memos': 'sales', customers: 'sales',
  // Expenses & bills
  bills: 'purchases', 'bill-payments': 'purchases', 'vendor-credits': 'purchases', vendors: 'purchases',
  'expense-transactions': 'purchases', checks: 'purchases', contractors: 'purchases',
  'ap-overview': 'purchases', 'unpaid-bills': 'purchases',
  // Banking
  'bank-accounts': 'banking', 'bank-transactions': 'banking', 'bank-imports': 'banking', 'bank-rules': 'banking',
  'bank-deposits': 'banking', 'bank-rec': 'banking', reconciliations: 'banking', transfers: 'banking',
  'imported-transactions': 'banking', 'integration-inbox': 'banking',
  // Accounting
  'journal-entries': 'accounting', coa: 'accounting', periods: 'accounting', 'fiscal-periods': 'accounting',
  'review-tasks': 'accounting', 'fixed-assets': 'accounting', 'recurring-templates': 'accounting',
  budgets: 'accounting', 'cost-centers': 'accounting', approvals: 'accounting', transactions: 'accounting',
  // Payroll
  employees: 'payroll', 'pay-runs': 'payroll', 'payroll-overview': 'payroll',
  'payroll-tax-liabilities': 'payroll', 'compliance-items': 'payroll', 'check-stubs': 'payroll',
  // Inventory
  'inventory-items': 'inventory', inventory: 'inventory', 'inventory-overview': 'inventory',
  'item-receipts': 'inventory', 'purchase-orders': 'inventory', 'sales-orders': 'inventory',
  'shipping-labels': 'inventory',
  // Reports
  reports: 'reports', 'csv-exports': 'reports', 'custom-reports': 'reports',
  'management-report': 'reports', 'performance-report': 'reports',
  // AI & documents
  ai: 'documents', suspense: 'documents', 'email-imports': 'documents', 'invoice-imports': 'documents',
  // Company & activity
  'tax-codes': 'company', 'activity-log': 'company', 'qb-import': 'company',
  // Messages
  messages: 'messages',
};

// The AI chat writes and runs read-only SQL over the ledger, sales, purchases and banking.
const CHAT_AREAS: Area[] = ['documents', 'sales', 'purchases', 'banking', 'accounting'];

/** Where an API path belongs, or null when it is in no area (a test keeps every route in one). */
export function apiPlaceOf(method: string, pathInBusiness: string): ApiPlace | null {
  const path = pathInBusiness.length > 1 ? pathInBusiness.replace(/\/+$/, '') : '/';
  if (method.toUpperCase() === 'GET' && LOOKUP_READS.has(path)) return { kind: 'lookup' };
  // The company itself: reading its name is a lookup (above); changing its settings is Company.
  if (path === '/') return { kind: 'area', area: 'company' };
  const segment = path.split('/')[1] ?? '';
  if (segment === 'files' || segment === 'receipts') return { kind: 'attachments' };
  if (segment === 'chat') return { kind: 'all', areas: CHAT_AREAS };
  const area = API_SEGMENT_AREA[segment];
  return area ? { kind: 'area', area } : null;
}

/**
 * The built-in role a custom role acts as for this request, or the areas that
 * refuse it. `unmapped` is a path in no area, refused rather than guessed at.
 */
export function roleForRequest(
  permissions: Permissions,
  method: string,
  pathInBusiness: string,
): { role: Role } | { refused: Area[] } | { unmapped: true } {
  const place = apiPlaceOf(method, pathInBusiness);
  if (!place) return { unmapped: true };
  return roleForPlace(permissions, place);
}

function roleForPlace(permissions: Permissions, place: ApiPlace): { role: Role } | { refused: Area[] } {
  switch (place.kind) {
    case 'area': {
      const level = permissions[place.area];
      return level === 'none' ? { refused: [place.area] } : { role: LEVEL_ROLE[level] };
    }
    case 'lookup':
      return highestLevel(permissions) === 'none' ? { refused: [] } : { role: 'viewer' };
    case 'attachments': {
      const top = highestLevel(permissions);
      if (top === 'none') return { refused: [] };
      return { role: levelRank(top) >= levelRank('enter') ? 'staff' : 'viewer' };
    }
    case 'all': {
      const refused = place.areas.filter(area => permissions[area] === 'none');
      if (refused.length > 0) return { refused };
      const lowest = place.areas.reduce<Level>((low, area) => (levelRank(permissions[area]) < levelRank(low) ? permissions[area] : low), 'full');
      return { role: LEVEL_ROLE[lowest as Exclude<Level, 'none'>] };
    }
  }
}

/** Shown when a custom role is refused: which area it lacks. */
export function refusalMessage(refused: Area[]): string {
  if (refused.length === 0) return 'Your role has no access to this company.';
  const names = refused.map(area => AREA_INFO[area].label);
  return `Your role has no access to ${names.join(', ')}. A firm admin can change it on Setup → Roles.`;
}

// ---------------------------------------------------------------------------
// Where a page of the web app belongs.

/**
 * - `area`: the level in that area decides, as for the API.
 * - `any`: open to any role with access to the company (the dashboard, My account).
 * - `attachments`: as for the API.
 * - `firm`: the firm's own pages, for a firm admin only (never a custom role).
 * - `client`: a client's own page (sending documents in).
 */
export type PagePlace =
  | { kind: 'area'; area: Area }
  | { kind: 'any' }
  | { kind: 'attachments' }
  | { kind: 'firm' }
  | { kind: 'client' };

// Longest prefix first wins, so `/reports/reconciliation` beats `/reports`.
const PAGE_PREFIXES: Array<[string, PagePlace]> = ([
  ['/firm', { kind: 'firm' }],
  ['/setup/users', { kind: 'firm' }],
  ['/setup/roles', { kind: 'firm' }],
  ['/clients/new', { kind: 'firm' }],
  ['/accounting/client-overview', { kind: 'firm' }],
  ['/documents/send', { kind: 'client' }],
  ['/account', { kind: 'any' }],
  ['/accounting/receipts', { kind: 'attachments' }],
  ['/invoices', { kind: 'area', area: 'sales' }],
  ['/payments', { kind: 'area', area: 'sales' }],
  ['/customers', { kind: 'area', area: 'sales' }],
  ['/estimates', { kind: 'area', area: 'sales' }],
  ['/credit-memos', { kind: 'area', area: 'sales' }],
  ['/ap', { kind: 'area', area: 'purchases' }],
  ['/accounting/checks', { kind: 'area', area: 'purchases' }],
  ['/accounting/expenses', { kind: 'area', area: 'purchases' }],
  ['/accounting/expense-transactions', { kind: 'area', area: 'purchases' }],
  ['/accounting/bank-accounts', { kind: 'area', area: 'banking' }],
  ['/accounting/bank-deposits', { kind: 'area', area: 'banking' }],
  ['/accounting/bank-transactions', { kind: 'area', area: 'banking' }],
  ['/accounting/reconcile', { kind: 'area', area: 'banking' }],
  ['/accounting/transfers', { kind: 'area', area: 'banking' }],
  ['/accounting/integrations', { kind: 'area', area: 'banking' }],
  ['/accounting/rules', { kind: 'area', area: 'banking' }],
  ['/accounting/register', { kind: 'area', area: 'banking' }],
  ['/reports/reconciliation', { kind: 'area', area: 'banking' }],
  ['/accounting/email-imports', { kind: 'area', area: 'documents' }],
  ['/accounting/invoice-imports', { kind: 'area', area: 'documents' }],
  ['/ai', { kind: 'area', area: 'documents' }],
  ['/accounting', { kind: 'area', area: 'accounting' }],
  ['/journal', { kind: 'area', area: 'accounting' }],
  ['/transactions', { kind: 'area', area: 'accounting' }],
  ['/coa', { kind: 'area', area: 'accounting' }],
  ['/setup/coa', { kind: 'area', area: 'accounting' }],
  ['/settings/coa', { kind: 'area', area: 'accounting' }],
  ['/settings/periods', { kind: 'area', area: 'accounting' }],
  ['/setup/cost-centers', { kind: 'area', area: 'accounting' }],
  ['/payroll', { kind: 'area', area: 'payroll' }],
  ['/inventory', { kind: 'area', area: 'inventory' }],
  ['/reports', { kind: 'area', area: 'reports' }],
  ['/setup', { kind: 'area', area: 'company' }],
  ['/settings', { kind: 'area', area: 'company' }],
  ['/messages', { kind: 'area', area: 'messages' }],
] as Array<[string, PagePlace]>).sort((a, b) => b[0].length - a[0].length);

/** Where a page belongs. A page in no list (the dashboard) is open to any access. */
export function pagePlaceOf(pathname: string): PagePlace {
  for (const [prefix, place] of PAGE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return place;
  }
  return { kind: 'any' };
}

/** The built-in role a custom role acts as on a page, or null when the page is not for it. */
export function roleForPage(permissions: Permissions, pathname: string): Role | null {
  const place = pagePlaceOf(pathname);
  switch (place.kind) {
    case 'firm':
    case 'client':
      return null;
    case 'any': {
      const top = highestLevel(permissions);
      return top === 'none' ? null : 'viewer';
    }
    case 'attachments': {
      const decided = roleForPlace(permissions, { kind: 'attachments' });
      return 'role' in decided ? decided.role : null;
    }
    case 'area': {
      const level = permissions[place.area];
      return level === 'none' ? null : LEVEL_ROLE[level];
    }
  }
}

