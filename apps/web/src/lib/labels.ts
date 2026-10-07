// Stored codes are written for the database ("bill_payment", "ach", "firm_admin").
// These turn them into something a person would read.

const SPECIAL_WORDS: Record<string, string> = { ach: 'ACH', je: 'JE', ap: 'A/P', ar: 'A/R', id: 'ID' };

/** "bill_payment" -> "Bill payment", "ach" -> "ACH", "firm_admin" -> "Firm admin". */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return '';
  return code.replace(/_/g, ' ').trim().toLowerCase().split(/\s+/)
    .map((word, i) => SPECIAL_WORDS[word] ?? (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** A quantity without padding: "1.0000" -> "1", "2.5000" -> "2.5", "1250.0000" -> "1,250". */
export function fmtQty(quantity: string | number | null | undefined): string {
  if (quantity === null || quantity === undefined || quantity === '') return '';
  const n = Number(quantity);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(quantity);
}
