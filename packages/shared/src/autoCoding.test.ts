import { describe, it, expect } from 'vitest';
import {
  normalizeVendor, confidenceBand, CODING_LAYERS, isCapitalizable, normalizeLineKey,
} from './autoCoding.js';

describe('normalizeVendor', () => {
  it('collapses payment-processor noise to one key', () => {
    const expected = 'amazon';
    for (const raw of [
      'AMZN Mktp US*AB12C',
      'AMAZON.COM*2Y4UF9GH3',
      'Amazon Marketplace',
      'AMAZON MKTPLACE PMTS',
      'amazon.com',
    ]) {
      expect(normalizeVendor(raw)).toBe(expected);
    }
  });

  it('strips card/ACH prefixes and trailing reference numbers', () => {
    expect(normalizeVendor('POS DEBIT DUKE ENERGY 4456')).toBe('duke energy');
    expect(normalizeVendor('ACH DEBIT  Hartford Insurance  #99812')).toBe('hartford insurance');
    expect(normalizeVendor('CHECKCARD 0921 STARBUCKS STORE 1234')).toBe('starbucks store');
    expect(normalizeVendor('SQ *BLUE BOTTLE COFFEE')).toBe('blue bottle coffee');
  });

  it('reads the vendor from the correct side of a star separator', () => {
    // VENDOR*REF - the name comes first, so sibling descriptors collapse together.
    expect(normalizeVendor('MICROSOFT*SUBSCRIPTION')).toBe('microsoft');
    expect(normalizeVendor('MICROSOFT*OFFICE365 8812')).toBe('microsoft');
    // PROCESSOR*VENDOR - the processor leads, so the name comes after.
    expect(normalizeVendor('SQ *BLUE BOTTLE COFFEE')).toBe('blue bottle coffee');
    expect(normalizeVendor('TST* CHIPOTLE 4420')).toBe('chipotle');
  });

  it('keeps distinct vendors distinct', () => {
    expect(normalizeVendor('DUKE ENERGY')).not.toBe(normalizeVendor('DUKE UNIVERSITY'));
  });

  it('is stable and idempotent', () => {
    const once = normalizeVendor('AMZN Mktp US*AB12C');
    expect(normalizeVendor(once)).toBe(once);
  });

  it('returns an empty string for input with no usable token', () => {
    expect(normalizeVendor('')).toBe('');
    expect(normalizeVendor('   ')).toBe('');
    expect(normalizeVendor('#4456 0921')).toBe('');
  });
});

describe('confidenceBand', () => {
  it('maps each documented range to its behavior', () => {
    expect(confidenceBand(100)).toBe('auto_post');
    expect(confidenceBand(98)).toBe('auto_post');
    expect(confidenceBand(97)).toBe('preselected');
    expect(confidenceBand(90)).toBe('preselected');
    expect(confidenceBand(89)).toBe('suggested');
    expect(confidenceBand(70)).toBe('suggested');
    expect(confidenceBand(69)).toBe('unclassified');
    expect(confidenceBand(0)).toBe('unclassified');
  });

  it('treats out-of-range values as their nearest band rather than throwing', () => {
    expect(confidenceBand(150)).toBe('auto_post');
    expect(confidenceBand(-5)).toBe('unclassified');
  });
});

describe('isCapitalizable', () => {
  it('capitalizes a long-lived tangible item at or above the threshold', () => {
    expect(isCapitalizable('Standing desk', 2750)).toBe(true);
    expect(isCapitalizable('Dell server rack', 2500)).toBe(true);
    expect(isCapitalizable('Leasehold improvements - suite 200', 18000)).toBe(true);
  });

  it('expenses the same item below the threshold', () => {
    expect(isCapitalizable('Standing desk', 2499)).toBe(false);
    expect(isCapitalizable('Office chair', 400)).toBe(false);
  });

  it('expenses large amounts that are not assets', () => {
    expect(isCapitalizable('Legal fees - acquisition review', 4000)).toBe(false);
    expect(isCapitalizable('Annual audit', 12000)).toBe(false);
  });

  it('expenses services performed on an asset', () => {
    // A repair or a rental is an expense however large.
    expect(isCapitalizable('HVAC repair', 6000)).toBe(false);
    expect(isCapitalizable('Equipment rental - crane', 9000)).toBe(false);
    expect(isCapitalizable('Server maintenance contract', 5000)).toBe(false);
    expect(isCapitalizable('Software subscription - 3 year license', 30000)).toBe(false);
  });

  it('honours a per-business threshold', () => {
    expect(isCapitalizable('Office furniture', 1200, 1000)).toBe(true);
    expect(isCapitalizable('Office furniture', 1200, 5000)).toBe(false);
  });

  it('treats a credit or negative amount by magnitude', () => {
    expect(isCapitalizable('Standing desk return', -2750)).toBe(true);
  });

  it('is safe on junk input', () => {
    expect(isCapitalizable('', 9999)).toBe(false);
    expect(isCapitalizable('desk', Number.NaN)).toBe(false);
  });
});

describe('normalizeLineKey', () => {
  it('collapses quantity and packaging noise', () => {
    expect(normalizeLineKey('Copy paper, 10 cases')).toBe('copy paper');
    expect(normalizeLineKey('Copy paper - 4 CASES')).toBe('copy paper');
    expect(normalizeLineKey('Year-end close support, 6 hrs')).toBe('year end close support');
  });

  it('keeps genuinely different lines distinct', () => {
    expect(normalizeLineKey('Standing desk')).not.toBe(normalizeLineKey('Copy paper'));
  });

  it('is idempotent', () => {
    const once = normalizeLineKey('Copy paper, 10 cases');
    expect(normalizeLineKey(once)).toBe(once);
  });
});

describe('CODING_LAYERS', () => {
  it('orders layers so deterministic rules outrank vendor, history, and AI', () => {
    const order = CODING_LAYERS.map(layer => layer.id);
    expect(order).toEqual(['learned_rule', 'accounting_rule', 'vendor_default', 'history', 'ai']);
  });
});
