import type { FastifyInstance } from "fastify";

import { registerAuthRoutes } from "../modules/auth/auth.routes.ts";
import { registerOrdersRoutes } from "../modules/orders/orders.routes.ts";
import { registerProductsRoutes } from "../modules/products/products.routes.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerRootRoutes } from "./root.ts";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerRootRoutes(app);
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerProductsRoutes(app);
  await registerOrdersRoutes(app);
}
