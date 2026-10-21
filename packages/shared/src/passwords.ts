// What a new password must not be (security review 2026-10-21). Length is the
// main rule; on top of it, a password built on a word attackers try first
// ("Password2026!", "Summer123", "qwertyuiop"), a run like "1234567890", or
// the person's own email or name is refused. No character-class rules: they
// make passwords harder to remember, not to guess.

export const PASSWORD_MIN_LENGTH = 10;
// bcrypt reads only the first 72 bytes; past that, the rest would not count.
export const PASSWORD_MAX_BYTES = 72;

// Words the commonest leaked passwords are built on, compared after the digits
// and symbols around them are taken off and look-alikes (0 for o, @ for a) read back.
const BASE_WORDS = new Set([
  'password', 'passw', 'pass', 'passwd', 'qwerty', 'qwertyuiop', 'qwertz', 'azerty', 'asdf', 'asdfgh', 'asdfghjkl',
  'zxcvbnm', 'qazwsx', 'letmein', 'welcome', 'admin', 'administrator', 'root', 'user', 'login', 'guest', 'test',
  'default', 'changeme', 'secret', 'iloveyou', 'loveyou', 'love', 'monkey', 'dragon', 'football', 'baseball',
  'soccer', 'hockey', 'sunshine', 'princess', 'master', 'shadow', 'superman', 'batman', 'trustno', 'starwars',
  'whatever', 'freedom', 'hello', 'charlie', 'michael', 'jordan', 'summer', 'winter', 'spring', 'autumn', 'fall',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november',
  'december', 'monday', 'friday', 'abc', 'abcd', 'abcdef', 'abcdefg', 'abcdefgh', 'abcdefghij',
  'accounting', 'accountant', 'bookkeeping', 'bookkeeper', 'quickbooks', 'company', 'business', 'office',
]);

const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** The word under the dressing: digits and symbols at either end off, look-alikes read back. */
function baseWord(lower: string): string {
  const trimmed = lower.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  return [...trimmed].map(ch => LOOK_ALIKES[ch] ?? ch).join('').replace(/[^a-z]/g, '');
}

/** Each character one up (or one down) from the last: 1234567890, abcdefghij, 0987654321. */
function isRun(text: string): boolean {
  // A 0 after the 9 (or before it, going down) carries on the run: ':' is the character after '9'.
  const steps = (chars: string, by: number) =>
    [...chars].every((ch, i, all) => i === 0 || ch.charCodeAt(0) - all[i - 1]!.charCodeAt(0) === by);
  return steps(text.replace(/0$/, ':'), 1) || steps(text.replace(/^0/, ':'), -1);
}

/**
 * Why `password` may not be used, or null when it may. `about` is the person
 * it is for, when known, so their email or name is refused as well.
 */
export function passwordProblem(password: string, about: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return `Use at most ${PASSWORD_MAX_BYTES} characters.`;
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower) || isRun(lower)) return 'That password is too easy to guess. Choose another.';
  const base = baseWord(lower);
  if (BASE_WORDS.has(base) || (base.length > 0 && /^(.)\1*$/.test(base))) {
    return 'That password is built on a word attackers try first. Choose another.';
  }
  const own = [about.email?.split('@')[0], ...(about.name?.split(/\s+/) ?? [])]
    .map(part => part?.toLowerCase().trim() ?? '')
    .filter(part => part.length >= 4);
  if (own.some(part => lower.includes(part))) return 'Do not use your email or name in your password.';
  return null;
}
