import type { FastifyInstance } from "fastify";

import {
  getCurrentTenant,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";

export async function registerProductsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/products",
    { preHandler: requireTenantPermission("products.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);

      return {
        items: [],
        pageInfo: {
          limit: 50,
          nextCursor: null,
          hasMore: false,
        },
        meta: {
          tenantId: tenant.id,
          implementationStatus: "pending",
        },
      };
    },
  );
}
