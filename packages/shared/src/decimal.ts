import { Decimal } from 'decimal.js';

// 4dp money, half-even rounding (banker's rounding) — the standard for accounting.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type MoneyInput = Decimal | string | number;

export function D(v: MoneyInput): Decimal {
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

export function parseMoney(v: MoneyInput): Decimal {
  const d = D(v);
  if (d.isNaN()) throw new Error(`Invalid money value: ${String(v)}`);
  return d;
}

export function addMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).plus(D(b));
}

export function subMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).minus(D(b));
}

export function mulMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).times(D(b));
}

export function roundMoney(v: MoneyInput): Decimal {
  return D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
}

export function toMoneyString(v: MoneyInput): string {
  return roundMoney(v).toFixed(4);
}

export function equalMoney(a: MoneyInput, b: MoneyInput): boolean {
  return roundMoney(a).equals(roundMoney(b));
}

export function isZero(v: MoneyInput): boolean {
  return roundMoney(v).isZero();
}
