import { Decimal } from 'decimal.js';
import type { AccountGroup } from '@accounting/shared';

// How the Balance Sheet is laid out, the way QuickBooks does it: accounts under
// their account type, the current types gathered under one heading with a
// subtotal, and the long-term ones after it.

export type GroupedLine = { amount: string; group?: AccountGroup | null };

export type SheetGroup<T> = {
  /** Heading for the account type, e.g. "Bank Accounts". */
  label: string;
  lines: T[];
  total: string;
};

export type SheetBlock<T> = {
  /** "Current Assets" / "Current Liabilities"; null for the types that stand on their own. */
  label: string | null;
  groups: SheetGroup<T>[];
  total: string;
};

type BlockPlan = { label: string | null; groups: ReadonlyArray<{ group: AccountGroup; label: string }> };

const ASSET_PLAN: BlockPlan[] = [
  {
    label: 'Current Assets',
    groups: [
      { group: 'Bank', label: 'Bank Accounts' },
      { group: 'Accounts receivable (A/R)', label: 'Accounts Receivable' },
      { group: 'Other Current Assets', label: 'Other Current Assets' },
    ],
  },
  { label: null, groups: [{ group: 'Fixed Assets', label: 'Fixed Assets' }] },
  { label: null, groups: [{ group: 'Other Assets', label: 'Other Assets' }] },
];

const LIABILITY_PLAN: BlockPlan[] = [
  {
    label: 'Current Liabilities',
    groups: [
      { group: 'Accounts payable (A/P)', label: 'Accounts Payable' },
      { group: 'Credit Card', label: 'Credit Cards' },
      { group: 'Other Current Liabilities', label: 'Other Current Liabilities' },
    ],
  },
  { label: null, groups: [{ group: 'Long Term Liabilities', label: 'Long-Term Liabilities' }] },
];

function sum(lines: GroupedLine[]): string {
  return lines.reduce((total, line) => total.plus(line.amount || '0'), new Decimal(0)).toFixed(4);
}

function layOut<T extends GroupedLine>(lines: T[], plan: BlockPlan[], fallback: AccountGroup): SheetBlock<T>[] {
  const known = new Set(plan.flatMap(block => block.groups.map(entry => entry.group)));
  // A line with no type, or one that belongs to the other side of the sheet,
  // still has to be shown and counted: it goes with the plainest current type.
  const groupOf = (line: T): AccountGroup => (line.group && known.has(line.group) ? line.group : fallback);
  return plan
    .map(block => {
      const groups = block.groups
        .map(entry => {
          const own = lines.filter(line => groupOf(line) === entry.group);
          return { label: entry.label, lines: own, total: sum(own) };
        })
        .filter(group => group.lines.length > 0);
      return { label: block.label, groups, total: sum(groups.flatMap(group => group.lines)) };
    })
    .filter(block => block.groups.length > 0);
}

/** Asset lines as Current Assets (bank, receivable, other current), Fixed Assets, Other Assets. */
export function assetBlocks<T extends GroupedLine>(lines: T[]): SheetBlock<T>[] {
  return layOut(lines, ASSET_PLAN, 'Other Current Assets');
}

/** Liability lines as Current Liabilities (payable, cards, other current), then Long-Term Liabilities. */
export function liabilityBlocks<T extends GroupedLine>(lines: T[]): SheetBlock<T>[] {
  return layOut(lines, LIABILITY_PLAN, 'Other Current Liabilities');
}
