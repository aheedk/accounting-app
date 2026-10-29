// Finding this company's records from the names QuickBooks writes in its
// exports. An account is written by its full name, a sub-account as
// `Parent:Child`, and each part may start with its number when the company
// numbers its accounts ("6000 Utilities:6010 Gas"). The name decides; a number
// only picks between accounts that share a name.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

export type MatchableAccount = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  account_type: string;
  detail_type: string | null;
  is_active: boolean;
  is_locked: boolean;
  system_key: string | null;
};

export const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** "6010 Gas" -> { number: '6010', name: 'Gas' }. A part that is only a number keeps it as its name. */
export function splitNumber(part: string): { number: string | null; name: string } {
  const m = /^(\d[\d.-]*)\s+(.+)$/.exec(part.trim());
  return m ? { number: m[1]!, name: m[2]!.trim() } : { number: null, name: part.trim() };
}

/** The parts of a QuickBooks account name, without their numbers. */
export function nameParts(label: string): { parts: string[]; number: string | null } {
  const raw = label.split(':').map(p => p.trim()).filter(p => p.length > 0);
  const split = raw.map(splitNumber);
  return { parts: split.map(s => s.name), number: split.at(-1)?.number ?? null };
}

/** Each account's full name, `Parent:Child`, from the parent chain. */
export function accountPaths(accounts: MatchableAccount[]): Map<string, string> {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const out = new Map<string, string>();
  const pathOf = (a: MatchableAccount, depth = 0): string => {
    const known = out.get(a.id);
    if (known !== undefined) return known;
    const parent = a.parent_id ? byId.get(a.parent_id) : undefined;
    const path = parent && depth < 20 ? `${pathOf(parent, depth + 1)}:${a.name}` : a.name;
    out.set(a.id, path);
    return path;
  };
  for (const a of accounts) pathOf(a);
  return out;
}

export type AccountMatch = { account: MatchableAccount } | { error: string };

export function makeAccountMatcher(accounts: MatchableAccount[]) {
  const paths = accountPaths(accounts);
  const byPath = new Map<string, MatchableAccount[]>();
  const byLeaf = new Map<string, MatchableAccount[]>();
  const byCode = new Map<string, MatchableAccount>();
  const add = (map: Map<string, MatchableAccount[]>, key: string, a: MatchableAccount) => {
    map.set(key, [...(map.get(key) ?? []), a]);
  };
  for (const a of accounts) {
    add(byPath, norm(paths.get(a.id)!), a);
    add(byLeaf, norm(a.name), a);
    byCode.set(norm(a.code), a);
  }
  const describe = (list: MatchableAccount[]) => list.map(a => `${a.code} ${paths.get(a.id)}`).join(', ');

  return (label: string): AccountMatch => {
    const { parts, number } = nameParts(label);
    if (parts.length === 0) return { error: 'No account name' };
    const pick = (list: MatchableAccount[] | undefined): AccountMatch | null => {
      if (!list || list.length === 0) return null;
      if (list.length === 1) return { account: list[0]! };
      const byNumber = number ? list.filter(a => norm(a.code) === norm(number)) : [];
      if (byNumber.length === 1) return { account: byNumber[0]! };
      return { error: `"${label}" could be more than one account: ${describe(list)}` };
    };
    // A label that is only a number ("1000") is the account with that number.
    if (parts.length === 1 && /^\d[\d.-]*$/.test(parts[0]!)) {
      const a = byCode.get(norm(parts[0]!));
      if (a) return { account: a };
    }
    return pick(byPath.get(norm(parts.join(':'))))
      ?? pick(byLeaf.get(norm(parts.at(-1)!)))
      ?? (number && byCode.get(norm(number)) ? { account: byCode.get(norm(number))! } : null)
      ?? { error: `No account named "${label}". Bring it in with the chart of accounts, or add it on Chart of Accounts` };
  };
}

/** Customers and vendors: the exact name, else the last part of a QuickBooks `Parent:Child` name. */
export function makeNameMatcher<T extends { id: string; name: string }>(rows: T[]) {
  const byName = new Map<string, T[]>();
  for (const r of rows) byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]);
  return (label: string): T | null => {
    const exact = byName.get(norm(label));
    if (exact?.length === 1) return exact[0]!;
    const last = label.split(':').at(-1)?.trim();
    if (last && last !== label.trim()) {
      const leaf = byName.get(norm(last));
      if (leaf?.length === 1) return leaf[0]!;
    }
    return null;
  };
}
