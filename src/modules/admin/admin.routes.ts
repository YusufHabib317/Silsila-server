import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import { requirePlatformAdmin } from "../auth/auth.middleware.ts";
import {
  adminAuditLogListQuerySchema,
  adminTenantListQuerySchema,
  uuidParamsSchema,
} from "./admin.schemas.ts";
import {
  getAdminSystemMetrics,
  getAdminTenantDetail,
  listAdminAuditLogs,
  listAdminTenants,
} from "./admin.service.ts";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/tenants",
    { preHandler: requirePlatformAdmin },
    async (request) => {
      const query = parseRequestInput(
        adminTenantListQuerySchema,
        request.query,
      );

      return listAdminTenants(query);
    },
  );

  app.get(
    "/admin/tenants/:id",
    { preHandler: requirePlatformAdmin },
    async (request) => {
      const params = parseRequestInput(uuidParamsSchema, request.params);

      return getAdminTenantDetail(params.id);
    },
  );

  app.get(
    "/admin/audit-logs",
    { preHandler: requirePlatformAdmin },
    async (request) => {
      const query = parseRequestInput(
        adminAuditLogListQuerySchema,
        request.query,
      );

      return listAdminAuditLogs(query);
    },
  );

  app.get(
    "/admin/system-metrics",
    { preHandler: requirePlatformAdmin },
    async () => getAdminSystemMetrics(),
  );
}
