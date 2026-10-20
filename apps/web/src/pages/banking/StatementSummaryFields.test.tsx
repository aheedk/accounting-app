// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatementSummaryFields } from './StatementSummaryFields';
import { NO_SUMMARY, summaryFormOf } from '@/lib/statementSummary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const lines = [
  { amount: '1000.00', type: 'deposit' },
  { amount: '49.99', type: 'expense' },
];

describe('StatementSummaryFields', () => {
  it('starts from what the AI read, as the form holds it', () => {
    expect(summaryFormOf({ period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: '5000.0000', ending_balance: null }))
      .toEqual({ period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: '5000.00', ending_balance: '' });
    expect(summaryFormOf({})).toEqual(NO_SUMMARY);
  });

  it('says when the lines add up to the ending balance', () => {
    const el = render(<StatementSummaryFields kind="bank" lines={lines} onChange={vi.fn()}
      value={{ ...NO_SUMMARY, beginning_balance: '5000.00', ending_balance: '5950.01' }} />);
    expect(el.textContent).toContain('The lines add up');
  });

  it('flags a statement whose lines miss its ending balance', () => {
    const el = render(<StatementSummaryFields kind="bank" lines={lines} onChange={vi.fn()}
      value={{ ...NO_SUMMARY, beginning_balance: '5000.00', ending_balance: '5830.01' }} />);
    expect(el.textContent).toContain('The lines are 120.00 off the ending balance');
  });

  it('asks for the balances when the AI could not read them, in card terms on a card', () => {
    const el = render(<StatementSummaryFields kind="credit_card" lines={lines} onChange={vi.fn()} value={NO_SUMMARY} />);
    expect(el.textContent).toContain('Type any balance the AI could not read');
    expect(el.textContent).toContain('New balance');
    expect(el.textContent).toContain('Closing date');
  });
});
