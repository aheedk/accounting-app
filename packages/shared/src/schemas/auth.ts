import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

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
