import { z } from 'zod';

/** Strip everything but digits, and drop a leading US/Canada country code 1 (so an 11-digit +1 number still reads as 10). */
function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** A phone number must be exactly 10 digits (area code + number) to be stored at all. */
export function isValidPhone(raw: string): boolean {
  return phoneDigits(raw).length === 10;
}

/** Nullable/optional phone field, shared by vendor/customer/business schemas: empty is fine, but a non-empty value must be a real 10-digit number. */
export const phoneSchema = z.string().max(50)
  .refine(v => v === '' || isValidPhone(v), { message: 'Phone number must have 10 digits, including area code' })
  .nullable().optional();
