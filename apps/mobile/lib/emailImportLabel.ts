import type { StagedImportRow, StagedTransaction, VendorRow } from '../services/api';

// Ports of apps/web/src/pages/banking/EmailImportReviewPage.tsx's
// deriveBankTitle/deriveBankSubtitle/bestVendorMatch — the API has no
// precomputed label field (confirmed gap, see services/api.ts's comment
// above listEmailImports), so this reproduces the exact same client-side
// derivation web already uses, rather than inventing a different one.

function isCard(imp: Pick<StagedImportRow, 'statement_kind'>): boolean {
  return imp.statement_kind === 'credit_card';
}

function derivePeriodTitle(imp: StagedImportRow): string {
  const txs = imp.extracted_transactions;
  const fallback = imp.email_subject ?? (isCard(imp) ? 'Credit Card Statement' : 'Bank Statement');
  if (txs.length === 0) return fallback;
  const dates = txs.flatMap(tx => {
    const [m, d, y] = tx.date.split('/');
    if (!m || !d || !y) return [];
    const dt = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return isNaN(dt.getTime()) ? [] : [dt];
  });
  if (dates.length === 0) return fallback;
  const minD = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxD = new Date(Math.max(...dates.map(d => d.getTime())));
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return fmt(minD) === fmt(maxD) ? `${fmt(minD)} Statement` : `${fmt(minD)} – ${fmt(maxD)} Statement`;
}

export function deriveImportTitle(imp: StagedImportRow): string {
  const period = derivePeriodTitle(imp);
  return imp.account_hint ? `${imp.account_hint} · ${period}` : period;
}

export function deriveImportSubtitle(imp: StagedImportRow): string {
  const txs = imp.extracted_transactions;
  if (isCard(imp)) {
    const charges = txs.filter(tx => tx.card_type === 'charge').length;
    const credits = txs.length - charges;
    return `Credit card · ${txs.length} transactions · ${charges} charges · ${credits} payments & credits`;
  }
  const deposits = txs.filter(tx => tx.type === 'credit' || tx.type === 'deposit').length;
  const payments = txs.filter(tx => tx.type === 'debit' || tx.type === 'expense' || tx.type === 'check').length;
  return `${txs.length} transactions · ${deposits} deposits · ${payments} payments`;
}

/** No real "partially reviewed" status exists server-side (gap #2) — inferred client-side. */
export function deriveImportStatus(imp: StagedImportRow): 'pending' | 'partially_reviewed' | 'approved' | 'rejected' {
  if (imp.status !== 'pending') return imp.status;
  const anyAutoPosted = imp.extracted_transactions.some(tx => tx.auto_posted);
  const allAutoPosted = imp.extracted_transactions.every(tx => tx.auto_posted);
  return anyAutoPosted && !allAutoPosted ? 'partially_reviewed' : 'pending';
}

const BUSINESS_SUFFIX = /\b(incorporated|inc|llc|l l c|corp|corporation|co|company|ltd|limited)\b\.?/g;

function nameTokens(name: string): Set<string> {
  return new Set(
    name.toLowerCase()
      .replace(BUSINESS_SUFFIX, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

/** The known vendor whose name best matches the AI's extracted payee string — still free text, just a starting point. */
export function bestVendorMatch(extracted: string, vendors: VendorRow[]): string | null {
  const trimmed = extracted.trim();
  if (!trimmed || vendors.length === 0) return null;
  const exact = vendors.find(v => v.name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact.name;
  let best: { name: string; score: number } | null = null;
  for (const vendor of vendors) {
    const score = nameSimilarity(trimmed, vendor.name);
    if (score > (best?.score ?? 0)) best = { name: vendor.name, score };
  }
  return best && best.score >= 0.5 ? best.name : null;
}

export function isInflowLine(tx: Pick<StagedTransaction, 'type'>): boolean {
  return tx.type === 'deposit' || tx.type === 'credit';
}
