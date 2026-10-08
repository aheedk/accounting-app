import { z } from 'zod';

export const USER_ROLES = ['firm_admin', 'accountant', 'staff', 'viewer', 'client'] as const;
export const userRoleSchema = z.enum(USER_ROLES);

export const userCreateSchema = z.object({
  email: z.string().email().max(320),
  full_name: z.string().min(1).max(200),
  role: userRoleSchema,
});
export type UserCreate = z.infer<typeof userCreateSchema>;

export const userRoleUpdateSchema = z.object({
  role: userRoleSchema,
});
export type UserRoleUpdate = z.infer<typeof userRoleUpdateSchema>;

export const businessAccessGrantSchema = z.object({
  business_id: z.string().uuid(),
  role_override: userRoleSchema.nullable().optional(),
});
export type BusinessAccessGrant = z.infer<typeof businessAccessGrantSchema>;

// The activity log: a page of who did what, optionally narrowed to one person or one kind of record.
export const activityLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
  user_id: z.string().uuid().optional(),
  entity_type: z.string().min(1).max(100).optional(),
});
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>;
