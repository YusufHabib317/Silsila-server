import type { FastifyInstance } from "fastify";

import { registerAdminRoutes } from "../modules/admin/admin.routes.ts";
import { registerAuthRoutes } from "../modules/auth/auth.routes.ts";
import { registerCommissionsRoutes } from "../modules/commissions/commissions.routes.ts";
import { registerContactsRoutes } from "../modules/contacts/contacts.routes.ts";
import { registerDashboardRoutes } from "../modules/dashboard/dashboard.routes.ts";
import { registerOrdersRoutes } from "../modules/orders/orders.routes.ts";
import { registerProductsRoutes } from "../modules/products/products.routes.ts";
import { registerWhatsappRoutes } from "../modules/whatsapp/whatsapp.routes.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerRootRoutes } from "./root.ts";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await registerRootRoutes(app);
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerWhatsappRoutes(app);
  await registerDashboardRoutes(app);
  await registerContactsRoutes(app);
  await registerProductsRoutes(app);
  await registerOrdersRoutes(app);
  await registerCommissionsRoutes(app);
}
