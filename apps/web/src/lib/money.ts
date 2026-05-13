import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export function fmtMoney(value: string | number): string {
  if (value === '' || value == null) return '0.00';
  const d = new Decimal(value);
  return d.toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSigned(value: string | number): string {
  const d = new Decimal(value);
  const abs = d.abs().toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (d.isNegative()) return `(${abs})`;
  return abs;
}

export function parseMoneyInput(value: string): string {
  // Permit empty; otherwise normalize to 4dp string.
  if (value === '') return '0.0000';
  const d = new Decimal(value);
  if (d.isNaN()) throw new Error(`Invalid amount: ${value}`);
  return d.toFixed(4);
}
