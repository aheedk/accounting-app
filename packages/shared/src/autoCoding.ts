/**
 * Shared vocabulary for the AI auto-coding engine.
 *
 * Kept in @accounting/shared because the web app renders confidence badges and
 * layer labels, and the API uses the same values to decide what to post.
 */

export type CodingLayerId =
  | 'learned_rule'
  | 'accounting_rule'
  | 'vendor_default'
  | 'history'
  | 'ai';

/** Default capitalization threshold; overridden per business. */
export const DEFAULT_CAPITALIZATION_THRESHOLD = 2500;

// Long-lived tangible things. Deliberately narrow: a false positive
// capitalizes something that should have been expensed, which is the more
// annoying error to unwind.
const CAPITAL_ASSET_TERMS = [
  'desk', 'chair', 'table', 'furniture', 'cabinet', 'shelving', 'workstation',
  'server', 'computer', 'laptop', 'monitor', 'printer', 'copier', 'scanner',
  'equipment', 'machine', 'machinery', 'tool', 'forklift', 'generator',
  'vehicle', 'truck', 'van', 'trailer',
  'hvac', 'air conditioner', 'furnace', 'boiler', 'roof',
  'leasehold', 'renovation', 'remodel', 'build-out', 'buildout',
  'fixture', 'signage', 'camera', 'projector', 'phone system',
];

// Wording that means a service on an asset, not the asset itself -- a repair
// or a subscription is an expense however large.
const NOT_CAPITAL_TERMS = [
  'repair', 'maintenance', 'service', 'cleaning', 'rental', 'rent', 'lease payment',
  'subscription', 'license', 'support', 'warranty', 'insurance', 'training',
  'delivery', 'shipping', 'freight', 'installation labor', 'consulting',
];

/**
 * Should this line be capitalized as a fixed asset rather than expensed?
 *
 * Both conditions must hold: at or above the threshold, AND a long-lived
 * tangible item. A $4,000 legal bill clears the threshold but is not an asset.
 */
export function isCapitalizable(
  description: string,
  amount: number,
  threshold: number = DEFAULT_CAPITALIZATION_THRESHOLD,
): boolean {
  if (!Number.isFinite(amount) || Math.abs(amount) < threshold) return false;
  const text = (description ?? '').toLowerCase();
  if (NOT_CAPITAL_TERMS.some(term => text.includes(term))) return false;
  return CAPITAL_ASSET_TERMS.some(term => text.includes(term));
}

/**
 * Stable key for an invoice line's description, used to learn per-line rules.
 *
 * Strips quantities and packaging noise so "Copy paper, 10 cases" and
 * "Copy paper - 4 cases" collapse to the same key.
 */
export function normalizeLineKey(description: string): string {
  return (description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    // Drop bare numbers and unit words that only describe quantity.
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\b(?:each|ea|pcs?|pieces?|cases?|boxes?|box|packs?|units?|qty|hrs?|hours?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type CodingLayer = {
  id: CodingLayerId;
  /** Shown in the review queue so a suggestion can explain itself. */
  label: string;
};

/**
 * Priority order. Deterministic accounting rules sit above vendor defaults,
 * history, and AI on purpose: a transfer between the client's own accounts or
 * the interest split on a loan payment is accounting treatment, not a
 * preference the model should be guessing at.
 */
export const CODING_LAYERS: readonly CodingLayer[] = [
  { id: 'learned_rule', label: 'Learned from this client' },
  { id: 'accounting_rule', label: 'Accounting rule' },
  { id: 'vendor_default', label: 'Vendor default account' },
  { id: 'history', label: 'Prior coding history' },
  { id: 'ai', label: 'AI confidence' },
] as const;

export type ConfidenceBand = 'auto_post' | 'preselected' | 'suggested' | 'unclassified';

export const CONFIDENCE_THRESHOLDS = {
  autoPost: 98,
  preselected: 90,
  suggested: 70,
} as const;

/** What the system does with a suggestion at this confidence. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_THRESHOLDS.autoPost) return 'auto_post';
  if (confidence >= CONFIDENCE_THRESHOLDS.preselected) return 'preselected';
  if (confidence >= CONFIDENCE_THRESHOLDS.suggested) return 'suggested';
  return 'unclassified';
}

// Leading noise banks prepend to a description: card rails, entry methods, and
// the transaction direction. Stripped before the vendor is read.
const LEADING_NOISE = new RegExp(
  '^(?:'
  + 'pos(?:\\s+(?:debit|credit|purchase))?|checkcard|check\\s?card|debit\\s+card|credit\\s+card'
  + '|ach(?:\\s+(?:debit|credit))?|eft|xfer|wire|recurring|preauthorized|pre-auth|purchase|payment'
  + '|sq|tst|py|ci|in|dd|pp|paypal|venmo|visa|mastercard|amex'
  + ')\\b[\\s*:-]*',
  'i',
);

// Processor tails: AMZN Mktp US*AB12C -> the *AB12C part, store/ref numbers,
// and trailing dates.
const PROCESSOR_REF = /[*#]\s*[a-z0-9-]*\d[a-z0-9-]*/gi;
const TRAILING_REF = /\b(?:no|num|ref|id|inv|invoice|trace|conf)\.?\s*[:#]?\s*[a-z0-9-]*\d[a-z0-9-]*\b/gi;
const BARE_NUMBER = /\b\d[\d.,/-]*\b/g;

// Vendor aliases that normalization alone cannot collapse, because the tokens
// genuinely differ (mktp vs marketplace vs .com).
const ALIASES: Record<string, string> = {
  'amzn': 'amazon',
  'amzn mktp': 'amazon',
  'amzn mktp us': 'amazon',
  'amazon mktp': 'amazon',
  'amazon mktplace': 'amazon',
  'amazon mktplace pmts': 'amazon',
  'amazon marketplace': 'amazon',
  'amazon com': 'amazon',
  'amazon digital': 'amazon',
  'wal mart': 'walmart',
  'wm supercenter': 'walmart',
  'the home depot': 'home depot',
  'home depot com': 'home depot',
  'microsoft corporation': 'microsoft',
  'msft': 'microsoft',
};

/**
 * Reduce a messy bank description to a stable vendor key.
 *
 * This is the join key for the learned-rule, history, and vendor-default
 * layers, so it must be deterministic and idempotent -- normalizing an
 * already-normalized value returns it unchanged.
 */
export function normalizeVendor(raw: string): string {
  let text = (raw ?? '').toLowerCase();

  // Strip leading rail/entry-method noise, possibly stacked ("pos debit ach").
  let previous: string;
  do {
    previous = text;
    text = text.replace(LEADING_NOISE, '');
  } while (text !== previous);

  // Card descriptors use either VENDOR*REF ("MICROSOFT*SUBSCRIPTION",
  // "AMZN Mktp US*AB12C") or PROCESSOR*VENDOR ("SQ *BLUE BOTTLE"). When a name
  // precedes the star it is the vendor; when the star leads -- the processor
  // prefix having just been stripped above -- the vendor follows it.
  const star = text.indexOf('*');
  if (star !== -1) {
    const left = text.slice(0, star).trim();
    const right = text.slice(star + 1).trim();
    text = left || right;
  }

  text = text
    .replace(PROCESSOR_REF, ' ')
    .replace(TRAILING_REF, ' ')
    // Separators and punctuation become spaces; letters and digits survive.
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(BARE_NUMBER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop trailing single-letter fragments left behind by stripped references
  // (e.g. "us" from "AMZN Mktp US*AB12C" is kept, but "c" is not).
  text = text.replace(/(?:\s+[a-z])+$/, '').trim();

  return ALIASES[text] ?? text;
}
