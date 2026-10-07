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

/**
 * What is left of typed text once everything that is not part of an amount is
 * dropped: digits, one decimal point, and a leading minus when allowed. Commas
 * and currency signs go, so a pasted "$9,000.00" still works.
 */
export function cleanMoneyInput(raw: string, allowNegative = false): string {
  const negative = allowNegative && raw.trim().startsWith('-');
  let digits = '';
  let seenPoint = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else if (ch === '.' && !seenPoint) { digits += ch; seenPoint = true; }
  }
  return negative ? `-${digits}` : digits;
}

/**
 * A typed amount settled to two decimals: "9" becomes "9.00". Precision someone
 * deliberately entered is kept up to four places (the ledger's own precision).
 * Blank, or not a number, settles to ''.
 */
export function settleMoneyInput(value: string): string {
  const text = value.replace(/,/g, '').trim();
  if (text === '') return '';
  let d: Decimal;
  try { d = new Decimal(text); } catch { return ''; }
  if (!d.isFinite()) return '';
  return d.toFixed(Math.min(4, Math.max(2, d.decimalPlaces())));
}

/** How an amount box shows its value when it is not being typed in: "9,000.00". */
export function fmtMoneyInput(value: string): string {
  const settled = settleMoneyInput(value);
  if (settled === '') return value;
  const [whole = '', fraction = ''] = settled.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function parseMoneyInput(value: string): string {
  // Permit empty; otherwise normalize to 4dp string.
  if (value === '') return '0.0000';
  const d = new Decimal(value);
  if (d.isNaN()) throw new Error(`Invalid amount: ${value}`);
  return d.toFixed(4);
}
