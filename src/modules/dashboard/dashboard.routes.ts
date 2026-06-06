import type { FastifyInstance } from "fastify";

import {
  getCurrentTenant,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import { getDashboardStats } from "./dashboard.service.ts";

export async function registerDashboardRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/dashboard/stats",
    { preHandler: requireTenantPermission("reports.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);

      return getDashboardStats(tenant.id);
    },
  );
}
