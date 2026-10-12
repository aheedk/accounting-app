import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPE_GROUPS, DETAIL_TYPES, accountGroup, accountGroupsOf } from './accountGroups.js';

describe('accountGroup', () => {
  it('reads the QuickBooks account type from the detail type', () => {
    expect(accountGroup({ account_type: 'asset', detail_type: 'Checking' })).toBe('Bank');
    expect(accountGroup({ account_type: 'asset', detail_type: 'Machinery & Equipment' })).toBe('Fixed Assets');
    expect(accountGroup({ account_type: 'asset', detail_type: 'Undeposited Funds' })).toBe('Other Current Assets');
    expect(accountGroup({ account_type: 'liability', detail_type: 'Credit Card' })).toBe('Credit Card');
    expect(accountGroup({ account_type: 'liability', detail_type: 'Notes Payable' })).toBe('Long Term Liabilities');
    expect(accountGroup({ account_type: 'liability', detail_type: 'Loan Payable' })).toBe('Other Current Liabilities');
    expect(accountGroup({ account_type: 'expense', detail_type: 'Supplies & Materials - COGS' })).toBe('Cost of Goods Sold');
    expect(accountGroup({ account_type: 'revenue', detail_type: 'Interest Earned' })).toBe('Other Income');
  });

  it('is not thrown by case or spaces', () => {
    expect(accountGroup({ account_type: 'asset', detail_type: ' cash on HAND ' })).toBe('Bank');
  });

  it('places the older detail types still on existing accounts', () => {
    expect(accountGroup({ account_type: 'asset', detail_type: 'Equipment' })).toBe('Fixed Assets');
    expect(accountGroup({ account_type: 'asset', detail_type: 'Accounts Receivable' })).toBe('Accounts receivable (A/R)');
    expect(accountGroup({ account_type: 'liability', detail_type: 'Accounts Payable' })).toBe('Accounts payable (A/P)');
    expect(accountGroup({ account_type: 'liability', detail_type: 'Mortgage' })).toBe('Long Term Liabilities');
    expect(accountGroup({ account_type: 'asset', detail_type: 'Suspense' })).toBe('Other Current Assets');
  });

  it('falls back to the plainest type of its kind', () => {
    expect(accountGroup({ account_type: 'asset', detail_type: null })).toBe('Other Current Assets');
    expect(accountGroup({ account_type: 'liability' })).toBe('Other Current Liabilities');
    expect(accountGroup({ account_type: 'equity', detail_type: 'Something new' })).toBe('Equity');
    expect(accountGroup({ account_type: 'revenue', detail_type: null })).toBe('Income');
    expect(accountGroup({ account_type: 'expense', detail_type: null })).toBe('Expenses');
  });

  it('never lets a detail type move an account to another base type', () => {
    // "Credit Card" is a liability type; on an asset it means nothing.
    expect(accountGroup({ account_type: 'asset', detail_type: 'Credit Card' })).toBe('Other Current Assets');
    expect(accountGroup({ account_type: 'mystery', detail_type: 'Checking' })).toBeNull();
  });
});

describe('the catalogue', () => {
  it('has detail types for every account type, each under one type only', () => {
    const seen = new Map<string, string>();
    for (const group of ACCOUNT_TYPE_GROUPS) {
      for (const item of group.items) {
        expect(DETAIL_TYPES[item].length).toBeGreaterThan(0);
        for (const detail of DETAIL_TYPES[item]) {
          const key = `${group.accountType}:${detail.toLowerCase()}`;
          expect(seen.get(key), `${detail} is listed twice`).toBeUndefined();
          seen.set(key, item);
        }
      }
    }
    expect(accountGroupsOf('liability')).toEqual(['Credit Card', 'Accounts payable (A/P)', 'Other Current Liabilities', 'Long Term Liabilities']);
    expect(accountGroupsOf('nope')).toEqual([]);
  });
});
