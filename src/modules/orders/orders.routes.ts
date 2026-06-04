import type { FastifyInstance } from "fastify";

import { AppError } from "../../lib/app-error.ts";
import { requireTenantPermission } from "../auth/auth.middleware.ts";

export async function registerOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/orders",
    { preHandler: requireTenantPermission("orders.create") },
    async () => {
      throw new AppError({
        code: "ORDERS_CREATE_NOT_IMPLEMENTED",
        message: "Order creation is not implemented yet.",
        statusCode: 501,
      });
    },
  );
}
