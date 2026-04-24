import { z } from 'zod';

export const employeeCreateSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.record(z.string().max(200)).nullable().optional(),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/).nullable().optional(),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termination_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  default_pay_rate_cents: z.number().int().min(0).optional(),
  default_pay_frequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']).optional(),
  w4_filing_status: z.enum(['single', 'married_jointly', 'married_separately', 'head_of_household']).nullable().optional(),
});
export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.record(z.string().max(200)).nullable().optional(),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/).nullable().optional(),
  termination_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  default_pay_rate_cents: z.number().int().min(0).optional(),
  default_pay_frequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']).optional(),
  w4_filing_status: z.enum(['single', 'married_jointly', 'married_separately', 'head_of_household']).nullable().optional(),
  is_active: z.boolean().optional(),
});
