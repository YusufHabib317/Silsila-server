import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  createProductSchema,
  productListQuerySchema,
  productParamsSchema,
  updateProductSchema,
} from "./products.schemas.ts";
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
} from "./products.service.ts";

export async function registerProductsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/products",
    { preHandler: requireTenantPermission("products.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(productListQuerySchema, request.query);

      return listProducts(tenant.id, query);
    },
  );

  app.get(
    "/products/:id",
    { preHandler: requireTenantPermission("products.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(productParamsSchema, request.params);

      return getProduct(tenant.id, params.id);
    },
  );

  app.post(
    "/products",
    { preHandler: requireTenantPermission("products.create") },
    async (request, reply) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const body = parseRequestInput(createProductSchema, request.body);
      const product = await createProduct(
        tenant.id,
        currentUser.user.id,
        body,
      );

      await reply.status(201).send(product);
    },
  );

  app.patch(
    "/products/:id",
    { preHandler: requireTenantPermission("products.update") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(productParamsSchema, request.params);
      const body = parseRequestInput(updateProductSchema, request.body);

      return updateProduct(tenant.id, currentUser.user.id, params.id, body);
    },
  );
}
