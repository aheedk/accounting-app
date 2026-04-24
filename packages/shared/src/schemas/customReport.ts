import { z } from 'zod';

export const customReportDefinitionSchema = z.object({
  account_ids: z.array(z.string().uuid()).min(0).max(500),
  date_range: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  group_by: z.enum(['account', 'month', 'cost_center', 'customer', 'vendor']),
  columns: z.array(z.enum(['debit', 'credit', 'net'])).min(1),
});
export type CustomReportDefinition = z.infer<typeof customReportDefinitionSchema>;

export const customReportCreateSchema = z.object({
  name: z.string().min(1).max(200),
  definition: customReportDefinitionSchema,
});
export type CustomReportCreate = z.infer<typeof customReportCreateSchema>;

export const customReportUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  definition: customReportDefinitionSchema.optional(),
});
