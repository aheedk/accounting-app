// US phone numbers, shown the same way everywhere: "(555) 123-4567" for a
// 10-digit number, "+1 (555) 123-4567" once a leading country code is kept.
// Anything that isn't a recognizable 10/11-digit US number is shown as typed
// (international numbers, extensions) rather than mangled into a wrong shape.

/** Digits only, leading "1" country code dropped if the rest is still 10 digits. */
function digitsOf(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** "5551234567" / "(555) 123-4567" / "555.123.4567" -> "(555) 123-4567". */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = digitsOf(raw);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Keeps only what a phone number can contain while typing — digits, and the
 * punctuation formatPhone itself produces — so a pasted "555-123-4567 x12"
 * extension isn't silently dropped mid-edit. */
export function cleanPhoneInput(raw: string): string {
  return raw.replace(/[^\d()\-.+ x]/gi, '');
}

/** Settle on blur: a recognizable 10-digit US number becomes "(555) 123-4567"; anything else is left exactly as typed. */
export function settlePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = digitsOf(trimmed);
  return digits.length === 10 ? formatPhone(trimmed) : trimmed;
}
