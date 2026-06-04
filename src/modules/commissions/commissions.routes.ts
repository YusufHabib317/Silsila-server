import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  commissionListQuerySchema,
  commissionParamsSchema,
  createCommissionSchema,
  updateCommissionSchema,
} from "./commissions.schemas.ts";
import {
  createCommission,
  getCommission,
  listCommissions,
  updateCommission,
} from "./commissions.service.ts";

export async function registerCommissionsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/commissions",
    { preHandler: requireTenantPermission("commissions.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(commissionListQuerySchema, request.query);

      return listCommissions(tenant.id, query);
    },
  );

  app.get(
    "/commissions/:id",
    { preHandler: requireTenantPermission("commissions.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(commissionParamsSchema, request.params);

      return getCommission(tenant.id, params.id);
    },
  );

  app.post(
    "/commissions",
    { preHandler: requireTenantPermission("commissions.update") },
    async (request, reply) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const body = parseRequestInput(createCommissionSchema, request.body);
      const commission = await createCommission(
        tenant.id,
        currentUser.user.id,
        body,
      );

      await reply.status(201).send(commission);
    },
  );

  app.patch(
    "/commissions/:id",
    { preHandler: requireTenantPermission("commissions.update") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(commissionParamsSchema, request.params);
      const body = parseRequestInput(updateCommissionSchema, request.body);

      return updateCommission(tenant.id, currentUser.user.id, params.id, body);
    },
  );
}
