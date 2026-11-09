import { z } from 'zod';
import { AREAS, LEVELS, type Area } from '../permissions.js';

export const USER_ROLES = ['firm_admin', 'accountant', 'staff', 'viewer', 'client'] as const;
export const userRoleSchema = z.enum(USER_ROLES);

// A login's role is a built-in one (`role`) or one of the firm's own
// (`custom_role_id`, docs/specs/2026-11-09-custom-roles-design.md). With a
// custom role, `role` is ignored: the login is stored as staff.
export const userCreateSchema = z.object({
  email: z.string().email().max(320),
  full_name: z.string().min(1).max(200),
  role: userRoleSchema,
  custom_role_id: z.string().uuid().nullable().optional(),
});
export type UserCreate = z.infer<typeof userCreateSchema>;

export const userRoleUpdateSchema = z.union([
  z.object({ role: userRoleSchema, custom_role_id: z.null().optional() }),
  z.object({ custom_role_id: z.string().uuid() }),
]);
export type UserRoleUpdate = z.infer<typeof userRoleUpdateSchema>;

// For one company: a built-in role, one of the firm's own, or neither (the login's own role applies).
export const businessAccessGrantSchema = z.object({
  business_id: z.string().uuid(),
  role_override: userRoleSchema.nullable().optional(),
  custom_role_id: z.string().uuid().nullable().optional(),
}).refine(v => !(v.role_override && v.custom_role_id), { message: 'Give either a built-in role or a custom role, not both.' });
export type BusinessAccessGrant = z.infer<typeof businessAccessGrantSchema>;

const levelSchema = z.enum(LEVELS);
export const permissionsSchema = z.object(
  Object.fromEntries(AREAS.map(area => [area, levelSchema])) as Record<Area, typeof levelSchema>,
).strict();

const BUILT_IN_NAMES = ['firm admin', 'accountant', 'staff', 'view only', 'viewer', 'client'];
const roleNameSchema = z.string().trim().min(1).max(60)
  .refine(name => !BUILT_IN_NAMES.includes(name.toLowerCase()), { message: 'That is the name of a built-in role. Choose another.' });

export const customRoleCreateSchema = z.object({
  name: roleNameSchema,
  description: z.string().trim().max(300).nullable().optional(),
  permissions: permissionsSchema,
});
export type CustomRoleCreate = z.infer<typeof customRoleCreateSchema>;

export const customRoleUpdateSchema = z.object({
  name: roleNameSchema.optional(),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: permissionsSchema.optional(),
});
export type CustomRoleUpdate = z.infer<typeof customRoleUpdateSchema>;

// The activity log: a page of who did what, optionally narrowed to one person or one kind of record.
export const activityLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
  user_id: z.string().uuid().optional(),
  entity_type: z.string().min(1).max(100).optional(),
});
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>;

export const payrollAccessSchema = z.object({ allowed: z.boolean() });
