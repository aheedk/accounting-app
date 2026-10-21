import { z } from 'zod';
import { passwordProblem } from '../passwords.js';

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  // The 6-digit code from an authenticator app, for a login that has the second step on.
  code: z.string().regex(/^\d{6}$/).optional(),
  // 'mobile' gets its refresh token back in the JSON body (no httpOnly
  // cookie reaches a native client) and a shorter refresh-token lifetime.
  client: z.enum(['web', 'mobile']).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// The person's own email and name are checked by the service, which knows them.
const newPassword = z.string().max(200).superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: newPassword,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

export const refreshMobileSchema = z.object({ refresh_token: z.string().min(1) });
export type RefreshMobileRequest = z.infer<typeof refreshMobileSchema>;

export const twoStepCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6 digits') });
export const twoStepOffSchema = z.object({ password: z.string().min(1).max(200) });

// The firm's sign-in settings, which a firm admin sets for every login.
export const IDLE_SIGN_OUT_MINUTES = [15, 30, 60, 120, 180] as const;
export const firmSecuritySchema = z.object({
  require_two_step: z.boolean().optional(),
  idle_sign_out_minutes: z.number().int().refine(
    (n): n is (typeof IDLE_SIGN_OUT_MINUTES)[number] => (IDLE_SIGN_OUT_MINUTES as readonly number[]).includes(n),
    'Choose 15, 30, 60, 120 or 180 minutes',
  ).optional(),
});
export type FirmSecurity = z.infer<typeof firmSecuritySchema>;

export const loginResponseSchema = z.object({
  access_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    role: z.enum(['firm_admin', 'accountant', 'staff', 'viewer', 'client']),
    firm_id: z.string().uuid(),
  }),
  businesses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    role_override: z.enum(['firm_admin', 'accountant', 'staff', 'viewer', 'client']).nullable(),
  })),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
