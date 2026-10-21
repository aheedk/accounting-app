import type { AccountGroup } from '@accounting/shared';
import type { BsLine } from '../services/api';

// Ported grouping from apps/web/src/lib/balanceSheetLayout.ts — same
// Current/Fixed/Other Assets and Current/Long-Term Liabilities buckets,
// built from each line's own `group` field (not re-derived).

const CURRENT_ASSET_GROUPS: AccountGroup[] = ['Bank', 'Accounts receivable (A/R)', 'Other Current Assets'];
const CURRENT_LIABILITY_GROUPS: AccountGroup[] = ['Accounts payable (A/P)', 'Credit Card', 'Other Current Liabilities'];

export type Block = { label: string; lines: BsLine[]; subtotal: number };

function sumLines(lines: BsLine[]): number {
  return lines.reduce((s, l) => s + parseFloat(l.amount), 0);
}

export function assetBlocks(lines: BsLine[]): Block[] {
  const current = lines.filter(l => CURRENT_ASSET_GROUPS.includes(l.group));
  const fixed = lines.filter(l => l.group === 'Fixed Assets');
  const other = lines.filter(l => l.group === 'Other Assets');
  const blocks: Block[] = [];
  if (current.length) blocks.push({ label: 'Current Assets', lines: current, subtotal: sumLines(current) });
  if (fixed.length) blocks.push({ label: 'Fixed Assets', lines: fixed, subtotal: sumLines(fixed) });
  if (other.length) blocks.push({ label: 'Other Assets', lines: other, subtotal: sumLines(other) });
  return blocks;
}

export function liabilityBlocks(lines: BsLine[]): Block[] {
  const current = lines.filter(l => CURRENT_LIABILITY_GROUPS.includes(l.group));
  const longTerm = lines.filter(l => l.group === 'Long Term Liabilities');
  const blocks: Block[] = [];
  if (current.length) blocks.push({ label: 'Current Liabilities', lines: current, subtotal: sumLines(current) });
  if (longTerm.length) blocks.push({ label: 'Long-Term Liabilities', lines: longTerm, subtotal: sumLines(longTerm) });
  return blocks;
}
