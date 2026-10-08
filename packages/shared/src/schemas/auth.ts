import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  // The 6-digit code from an authenticator app, for a login that has the second step on.
  code: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const newPassword = z.string().min(10, 'Use at least 10 characters').max(200);

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: newPassword,
});
export type PasswordChange = z.infer<typeof passwordChangeSchema>;

export const twoStepCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6 digits') });
export const twoStepOffSchema = z.object({ password: z.string().min(1).max(200) });

export const loginResponseSchema = z.object({
  access_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    role: z.enum(['firm_admin', 'accountant', 'staff', 'client']),
    firm_id: z.string().uuid(),
  }),
  businesses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    role_override: z.enum(['firm_admin', 'accountant', 'staff', 'client']).nullable(),
  })),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
