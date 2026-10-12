export type GeneralLedgerColumnKey =
  | 'date'
  | 'transaction'
  | 'reference'
  | 'adj'
  | 'name'
  | 'memo'
  | 'split'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'class'
  | 'createDate'
  | 'createdBy'
  | 'lastModified';

export type GeneralLedgerSortDirection = 'oldest' | 'newest';
export type GeneralLedgerDensity = 'comfortable' | 'compact';

export type GeneralLedgerPreferences = {
  columnOrder: GeneralLedgerColumnKey[];
  visibleColumns: GeneralLedgerColumnKey[];
  sortDirection: GeneralLedgerSortDirection;
  density: GeneralLedgerDensity;
  showAccountNumbers: boolean;
  showAccountDetails: boolean;
  showBeginningBalances: boolean;
  showAccountTotals: boolean;
  showReportTotal: boolean;
};

export const GENERAL_LEDGER_COLUMNS: ReadonlyArray<{ key: GeneralLedgerColumnKey; label: string; numeric?: boolean }> = [
  { key: 'date', label: 'Date' },
  { key: 'transaction', label: 'Transaction Type' },
  { key: 'reference', label: 'Num' },
  { key: 'adj', label: 'Adj' },
  { key: 'name', label: 'Name' },
  { key: 'memo', label: 'Memo / Description' },
  { key: 'split', label: 'Split' },
  { key: 'debit', label: 'Debit', numeric: true },
  { key: 'credit', label: 'Credit', numeric: true },
  { key: 'amount', label: 'Amount', numeric: true },
  { key: 'balance', label: 'Balance', numeric: true },
  { key: 'class', label: 'Class' },
  { key: 'createDate', label: 'Create Date' },
  { key: 'createdBy', label: 'Created By' },
  { key: 'lastModified', label: 'Last Modified' },
];

const COLUMN_KEYS = GENERAL_LEDGER_COLUMNS.map(column => column.key);
// Shown until the user picks otherwise; the rest are opt-in from Customize.
const DEFAULT_VISIBLE: GeneralLedgerColumnKey[] = [
  'date', 'transaction', 'reference', 'adj', 'name', 'memo', 'split', 'amount', 'balance',
];
const STORAGE_KEY = 'accounting.general-ledger.preferences.v4';

export function defaultGeneralLedgerPreferences(): GeneralLedgerPreferences {
  return {
    columnOrder: [...COLUMN_KEYS],
    visibleColumns: [...DEFAULT_VISIBLE],
    sortDirection: 'oldest',
    density: 'comfortable',
    showAccountNumbers: true,
    showAccountDetails: true,
    showBeginningBalances: true,
    showAccountTotals: true,
    showReportTotal: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validColumns(value: unknown): GeneralLedgerColumnKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key, index): key is GeneralLedgerColumnKey => (
    typeof key === 'string'
    && COLUMN_KEYS.includes(key as GeneralLedgerColumnKey)
    && value.indexOf(key) === index
  ));
}

export function normalizeGeneralLedgerPreferences(value: unknown): GeneralLedgerPreferences {
  const defaults = defaultGeneralLedgerPreferences();
  if (!isRecord(value)) return defaults;

  const suppliedOrder = validColumns(value['columnOrder']);
  const columnOrder = [...suppliedOrder, ...COLUMN_KEYS.filter(key => !suppliedOrder.includes(key))];
  const suppliedVisible = validColumns(value['visibleColumns']);
  const visibleColumns = suppliedVisible.length > 0 ? suppliedVisible : defaults.visibleColumns;

  return {
    columnOrder,
    visibleColumns,
    sortDirection: value['sortDirection'] === 'newest' ? 'newest' : 'oldest',
    density: value['density'] === 'compact' ? 'compact' : 'comfortable',
    showAccountNumbers: typeof value['showAccountNumbers'] === 'boolean' ? value['showAccountNumbers'] : defaults.showAccountNumbers,
    showAccountDetails: typeof value['showAccountDetails'] === 'boolean' ? value['showAccountDetails'] : defaults.showAccountDetails,
    showBeginningBalances: typeof value['showBeginningBalances'] === 'boolean' ? value['showBeginningBalances'] : defaults.showBeginningBalances,
    showAccountTotals: typeof value['showAccountTotals'] === 'boolean' ? value['showAccountTotals'] : defaults.showAccountTotals,
    showReportTotal: typeof value['showReportTotal'] === 'boolean' ? value['showReportTotal'] : defaults.showReportTotal,
  };
}

export function loadGeneralLedgerPreferences(): GeneralLedgerPreferences {
  if (typeof window === 'undefined') return defaultGeneralLedgerPreferences();
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeGeneralLedgerPreferences(JSON.parse(saved)) : defaultGeneralLedgerPreferences();
  } catch {
    return defaultGeneralLedgerPreferences();
  }
}

export function saveGeneralLedgerPreferences(preferences: GeneralLedgerPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A blocked or full localStorage should never prevent the report from working.
  }
}

export function moveGeneralLedgerColumn(
  order: GeneralLedgerColumnKey[],
  key: GeneralLedgerColumnKey,
  direction: -1 | 1,
): GeneralLedgerColumnKey[] {
  const index = order.indexOf(key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

// Sorting by a column heading. Not saved with the preferences above: it is a
// way of looking at the report that is open, and a reload goes back to date order.
export type GeneralLedgerColumnSort = { column: GeneralLedgerColumnKey; direction: 'asc' | 'desc' };

/** What a click on a heading does: ascending, then descending, then back to date order. */
export function nextColumnSort(
  current: GeneralLedgerColumnSort | null, column: GeneralLedgerColumnKey,
): GeneralLedgerColumnSort | null {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

/**
 * The lines in the order asked for. Numbers compare as numbers and text
 * without regard to case ("JE-9" before "JE-10"). Lines that tie keep the order
 * they came in, and a line with nothing in the column goes last either way.
 */
export function sortLedgerLines<T>(
  lines: T[], direction: 'asc' | 'desc', valueOf: (line: T) => string | number,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return lines
    .map((line, index) => ({ line, index, value: valueOf(line) }))
    .sort((left, right) => {
      const leftEmpty = left.value === '';
      const rightEmpty = right.value === '';
      if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? left.index - right.index : leftEmpty ? 1 : -1;
      const order = typeof left.value === 'number' && typeof right.value === 'number'
        ? left.value - right.value
        : String(left.value).localeCompare(String(right.value), undefined, { numeric: true, sensitivity: 'base' });
      return order !== 0 ? order * sign : left.index - right.index;
    })
    .map(entry => entry.line);
}
