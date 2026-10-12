import { describe, expect, it } from 'vitest';
import { assetBlocks, liabilityBlocks } from './balanceSheetLayout';

describe('Balance Sheet layout', () => {
  it('gathers the current asset types under one heading with a subtotal', () => {
    const blocks = assetBlocks([
      { name: 'Checking', amount: '100.0000', group: 'Bank' as const },
      { name: 'Truck', amount: '900.0000', group: 'Fixed Assets' as const },
      { name: 'Savings', amount: '50.0000', group: 'Bank' as const },
      { name: 'Prepaid', amount: '25.5000', group: 'Other Current Assets' as const },
    ]);

    expect(blocks.map(block => [block.label, block.total])).toEqual([
      ['Current Assets', '175.5000'],
      [null, '900.0000'],
    ]);
    expect(blocks[0]!.groups.map(group => [group.label, group.total, group.lines.map(line => line.name)])).toEqual([
      ['Bank Accounts', '150.0000', ['Checking', 'Savings']],
      ['Other Current Assets', '25.5000', ['Prepaid']],
    ]);
    expect(blocks[1]!.groups[0]!.label).toBe('Fixed Assets');
  });

  it('splits liabilities into current and long-term', () => {
    const blocks = liabilityBlocks([
      { amount: '600.0000', group: 'Long Term Liabilities' as const },
      { amount: '75.0000', group: 'Credit Card' as const },
      { amount: '10.0000', group: 'Accounts payable (A/P)' as const },
    ]);
    expect(blocks.map(block => [block.label, block.total])).toEqual([
      ['Current Liabilities', '85.0000'],
      [null, '600.0000'],
    ]);
    expect(blocks[0]!.groups.map(group => group.label)).toEqual(['Accounts Payable', 'Credit Cards']);
    expect(blocks[1]!.groups[0]!.label).toBe('Long-Term Liabilities');
  });

  it('still shows and counts a line with no type, or a type from the other side', () => {
    const blocks = assetBlocks([
      { amount: '10.0000' },
      { amount: '5.0000', group: 'Credit Card' as const },
      { amount: '-2.0000', group: null },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.groups[0]).toMatchObject({ label: 'Other Current Assets', total: '13.0000' });
    expect(blocks[0]!.groups[0]!.lines).toHaveLength(3);
  });

  it('leaves out empty types and gives nothing for no lines', () => {
    expect(assetBlocks([])).toEqual([]);
  });
});
