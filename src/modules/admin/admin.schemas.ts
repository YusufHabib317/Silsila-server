import { z } from "zod";

const tenantStatusValues = ["active", "trial", "disabled", "deleted"] as const;
const tenantPlanValues = ["free", "starter", "pro", "enterprise"] as const;

export const uuidParamsSchema = z.object({
  id: z.string().uuid(),
});

export const adminTenantListQuerySchema = z.object({
  status: z.enum(tenantStatusValues).optional(),
  plan: z.enum(tenantPlanValues).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const adminAuditLogListQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export type AdminTenantListQuery = z.infer<typeof adminTenantListQuerySchema>;
export type AdminAuditLogListQuery = z.infer<
  typeof adminAuditLogListQuerySchema
>;
