// Generic per-user, per-page list customization (QBO's gear-icon "Table
// settings" panel). Mirrors lib/generalLedgerCustomization.ts's localStorage
// pattern, generalized to any column key set instead of a fixed GL union —
// no backend table exists for this yet, and user-scoped browser storage is
// the simplest option that needs no new infra (CLAUDE.md ambiguity rule #3).

export type TableSortRule = { columnKey: string; direction: 'asc' | 'desc' };
export type TableRowHeight = 'compact' | 'comfortable' | 'spacious';

export type TableSettings = {
  sort: TableSortRule[];
  pageSize: number;
  rowHeight: TableRowHeight;
  alternateRowColor: boolean;
  columnOrder: string[];
  visibleColumns: string[];
  filterOrder: string[];
};

export function defaultTableSettings(allColumnKeys: string[]): TableSettings {
  return {
    sort: [],
    pageSize: 25,
    rowHeight: 'comfortable',
    alternateRowColor: false,
    columnOrder: [...allColumnKeys],
    visibleColumns: [...allColumnKeys],
    filterOrder: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validKeys(value: unknown, allColumnKeys: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key, index): key is string => (
    typeof key === 'string' && allColumnKeys.includes(key) && value.indexOf(key) === index
  ));
}

export function normalizeTableSettings(value: unknown, allColumnKeys: string[]): TableSettings {
  const defaults = defaultTableSettings(allColumnKeys);
  if (!isRecord(value)) return defaults;

  const suppliedOrder = validKeys(value['columnOrder'], allColumnKeys);
  const columnOrder = [...suppliedOrder, ...allColumnKeys.filter(k => !suppliedOrder.includes(k))];
  const suppliedVisible = validKeys(value['visibleColumns'], allColumnKeys);
  const visibleColumns = suppliedVisible.length > 0 ? suppliedVisible : defaults.visibleColumns;

  const sortRaw = Array.isArray(value['sort']) ? value['sort'] : [];
  const sort: TableSortRule[] = sortRaw
    .filter(isRecord)
    .filter(r => typeof r['columnKey'] === 'string' && allColumnKeys.includes(r['columnKey'] as string))
    .map(r => ({ columnKey: r['columnKey'] as string, direction: r['direction'] === 'desc' ? 'desc' : 'asc' }));

  const pageSize = typeof value['pageSize'] === 'number' && [10, 25, 50, 100, 150].includes(value['pageSize'])
    ? value['pageSize'] : defaults.pageSize;
  const rowHeight = value['rowHeight'] === 'compact' || value['rowHeight'] === 'spacious' ? value['rowHeight'] : defaults.rowHeight;

  return {
    sort,
    pageSize,
    rowHeight,
    alternateRowColor: typeof value['alternateRowColor'] === 'boolean' ? value['alternateRowColor'] : defaults.alternateRowColor,
    columnOrder,
    visibleColumns,
    filterOrder: Array.isArray(value['filterOrder']) ? value['filterOrder'].filter((v): v is string => typeof v === 'string') : [],
  };
}

function storageKey(userId: string, pageId: string): string {
  return `table_settings:${userId}:${pageId}`;
}

export function loadTableSettings(userId: string, pageId: string, allColumnKeys: string[]): TableSettings {
  if (typeof window === 'undefined') return defaultTableSettings(allColumnKeys);
  try {
    const saved = window.localStorage.getItem(storageKey(userId, pageId));
    return saved ? normalizeTableSettings(JSON.parse(saved), allColumnKeys) : defaultTableSettings(allColumnKeys);
  } catch {
    return defaultTableSettings(allColumnKeys);
  }
}

export function saveTableSettings(userId: string, pageId: string, settings: TableSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId, pageId), JSON.stringify(settings));
  } catch {
    // A blocked or full localStorage should never prevent the list from working.
  }
}

export function moveTableColumn(order: string[], key: string, direction: -1 | 1): string[] {
  const index = order.indexOf(key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

export const ROW_HEIGHT_CLASS: Record<TableRowHeight, string> = {
  compact: 'py-1',
  comfortable: 'py-3',
  spacious: 'py-5',
};
