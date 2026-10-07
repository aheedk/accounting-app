import { addMoney, toMoneyString } from '@accounting/shared';

/** One customer or vendor on an aging summary. Credits are negative. */
export type AgingRow = {
  id: string;
  name: string;
  current: string;
  days_1_30: string;
  days_31_60: string;
  days_61_90: string;
  days_over_90: string;
  total: string;
};

type Bucket = 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_over_90';

const ONE_DAY = 24 * 3600 * 1000;

/** Whole days from `date` to `asOf` (both YYYY-MM-DD); negative when `date` is later. */
export function daysBetween(asOf: string, date: string): number {
  const from = new Date(`${String(date).slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${asOf}T00:00:00Z`).getTime();
  return Math.floor((to - from) / ONE_DAY);
}

function bucketFor(daysPast: number): Bucket {
  if (daysPast <= 0) return 'current';
  if (daysPast <= 30) return 'days_1_30';
  if (daysPast <= 60) return 'days_31_60';
  if (daysPast <= 90) return 'days_61_90';
  return 'days_over_90';
}

/** Collects open amounts per party into the standard aging buckets. */
export class AgingTable {
  private readonly rows = new Map<string, AgingRow>();

  /** `amount` is signed: an open invoice or bill is positive, an unused credit negative. */
  add(party: { id: string; name: string }, amount: string, daysPast: number): void {
    let row = this.rows.get(party.id);
    if (!row) {
      row = {
        id: party.id, name: party.name,
        current: '0.0000', days_1_30: '0.0000', days_31_60: '0.0000', days_61_90: '0.0000', days_over_90: '0.0000',
        total: '0.0000',
      };
      this.rows.set(party.id, row);
    }
    const bucket = bucketFor(daysPast);
    row[bucket] = toMoneyString(addMoney(row[bucket], amount));
    row.total = toMoneyString(addMoney(row.total, amount));
  }

  /** Parties with something outstanding or an unused credit, by name. */
  result(): AgingRow[] {
    return [...this.rows.values()]
      .filter(row => [row.current, row.days_1_30, row.days_31_60, row.days_61_90, row.days_over_90].some(v => parseFloat(v) !== 0))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
