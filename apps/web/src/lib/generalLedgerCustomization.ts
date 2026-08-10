export type GeneralLedgerColumnKey =
  | 'date'
  | 'transaction'
  | 'reference'
  | 'memo'
  | 'debit'
  | 'credit'
  | 'balance';

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
  { key: 'transaction', label: 'Transaction' },
  { key: 'reference', label: 'Reference' },
  { key: 'memo', label: 'Memo' },
  { key: 'debit', label: 'Debit', numeric: true },
  { key: 'credit', label: 'Credit', numeric: true },
  { key: 'balance', label: 'Balance', numeric: true },
];

const COLUMN_KEYS = GENERAL_LEDGER_COLUMNS.map(column => column.key);
const STORAGE_KEY = 'accounting.general-ledger.preferences.v1';

export function defaultGeneralLedgerPreferences(): GeneralLedgerPreferences {
  return {
    columnOrder: [...COLUMN_KEYS],
    visibleColumns: [...COLUMN_KEYS],
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
