import { describe, expect, it } from 'vitest';
import { activityRecordName, activityVerb } from './activityLabels';

describe('activityVerb', () => {
  it('says what happened in words', () => {
    expect(activityVerb('invoice.post')).toBe('Posted');
    expect(activityVerb('auth.login_failed')).toBe('Wrong password or code');
    expect(activityVerb('user.deactivate')).toBe('Switched off');
    expect(activityVerb('suspense.reclassify')).toBe('Reclassify');
  });
});

describe('activityRecordName', () => {
  it('picks the field that names the record', () => {
    expect(activityRecordName({ id: 'x', invoice_number: 'INV-1042', memo: 'thanks' })).toBe('INV-1042');
    expect(activityRecordName({ payee_text: 'Staples' })).toBe('Staples');
    expect(activityRecordName({ email: 'pat@firm.com' })).toBe('pat@firm.com');
  });

  it('shortens a long one and gives nothing when there is nothing', () => {
    expect(activityRecordName({ memo: 'x'.repeat(80) })).toHaveLength(58);
    expect(activityRecordName({ amount: '5.00' })).toBeNull();
    expect(activityRecordName(null)).toBeNull();
  });
});
