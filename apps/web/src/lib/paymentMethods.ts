export type PaymentMethod = 'cash' | 'check' | 'ach' | 'wire' | 'card' | 'other';

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire transfer' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export function paymentMethodLabel(value: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find(option => option.value === value)?.label ?? value;
}
