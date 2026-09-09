import { describe, expect, it } from 'vitest';
import { JournalNumberRequestGate } from './journalNumberPreview';

describe('JournalNumberRequestGate', () => {
  it('rejects an older preview response after Copy requests a fresh number', () => {
    const gate = new JournalNumberRequestGate();
    const originalRequest = gate.start();

    gate.invalidate();
    const copyRequest = gate.start();

    expect(gate.isCurrent(originalRequest)).toBe(false);
    expect(gate.isCurrent(copyRequest)).toBe(true);
  });
});
