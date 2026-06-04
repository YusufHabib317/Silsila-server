import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  createOrderSchema,
  orderListQuerySchema,
  orderParamsSchema,
  updateOrderSchema,
} from "./orders.schemas.ts";
import {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
} from "./orders.service.ts";

export async function registerOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/orders",
    { preHandler: requireTenantPermission("orders.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(orderListQuerySchema, request.query);

      return listOrders(tenant.id, query);
    },
  );

  app.get(
    "/orders/:id",
    { preHandler: requireTenantPermission("orders.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(orderParamsSchema, request.params);

      return getOrder(tenant.id, params.id);
    },
  );

  app.post(
    "/orders",
    { preHandler: requireTenantPermission("orders.create") },
    async (request, reply) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const body = parseRequestInput(createOrderSchema, request.body);
      const order = await createOrder(tenant.id, currentUser.user.id, body);

      await reply.status(201).send(order);
    },
  );

  app.patch(
    "/orders/:id",
    { preHandler: requireTenantPermission("orders.update") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(orderParamsSchema, request.params);
      const body = parseRequestInput(updateOrderSchema, request.body);

      return updateOrder(tenant.id, currentUser.user.id, params.id, body);
    },
  );
}
