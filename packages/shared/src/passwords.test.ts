import { describe, expect, it } from 'vitest';
import { passwordProblem } from './passwords';

// Security review 2026-10-21: what a new password must not be.
describe('passwordProblem', () => {
  it('takes a long password that is not built on a common word', () => {
    expect(passwordProblem('brass-lantern-river-9')).toBeNull();
    expect(passwordProblem('correct horse battery staple')).toBeNull();
    expect(passwordProblem('Mw7#qL2!zR9v')).toBeNull();
  });

  it('refuses short ones, and ones past what bcrypt reads', () => {
    expect(passwordProblem('short-9')).toMatch(/at least 10/);
    expect(passwordProblem('x'.repeat(40) + 'y'.repeat(33))).toMatch(/at most 72/);
  });

  it('refuses runs, repeats and common words dressed up with digits and symbols', () => {
    for (const weak of ['1234567890', '0987654321', 'abcdefghij', 'aaaaaaaaaaaa', 'Password2026!', 'P@ssw0rd123', 'Summer2026!!', 'qwertyuiop', '!!Accounting1', 'iloveyou2026']) {
      expect(passwordProblem(weak), weak).not.toBeNull();
    }
  });

  it("refuses the person's own email or name", () => {
    expect(passwordProblem('pat.lee-2026-ledger', { email: 'pat.lee@firm.com' })).toMatch(/email or name/);
    expect(passwordProblem('ortiz-likes-ledgers', { name: 'Sam Ortiz' })).toMatch(/email or name/);
    // Parts shorter than four letters are too common to hold against anyone.
    expect(passwordProblem('sam-rides-the-river', { name: 'Sam Ortiz' })).toBeNull();
  });
});
