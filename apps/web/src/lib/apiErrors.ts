// The API's zod 400s carry per-field messages in error.field_errors
// (see apps/api/src/middleware/error.ts). Surface them instead of the
// generic "Input validation failed".
type ApiErrorPayload = {
  message?: string;
  field_errors?: Record<string, string[] | undefined> | null;
};

type ApiErrorShape = {
  response?: { data?: { error?: ApiErrorPayload } };
};

function fieldLabel(path: string): string {
  return path.replace(/_/g, ' ').replace(/\./g, ' → ');
}

export function pickErr(e: unknown): string {
  const err = (e as ApiErrorShape | undefined)?.response?.data?.error;
  if (!err) return 'Failed';
  const fields = err.field_errors;
  if (fields) {
    const parts = Object.entries(fields)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([k, v]) => `${fieldLabel(k)}: ${v[0]}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return err.message ?? 'Failed';
}

/** Per-field lookup for forms that render messages next to inputs. */
export function pickFieldErrors(e: unknown): Record<string, string> {
  const fields = (e as ApiErrorShape | undefined)?.response?.data?.error?.field_errors;
  const out: Record<string, string> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}
