import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  contactListQuerySchema,
  contactParamsSchema,
  createContactSchema,
  updateContactSchema,
} from "./contacts.schemas.ts";
import {
  createContact,
  getContact,
  listContacts,
  updateContact,
} from "./contacts.service.ts";

export async function registerContactsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/contacts",
    { preHandler: requireTenantPermission("contacts.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(contactListQuerySchema, request.query);

      return listContacts(tenant.id, query);
    },
  );

  app.get(
    "/contacts/:id",
    { preHandler: requireTenantPermission("contacts.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(contactParamsSchema, request.params);

      return getContact(tenant.id, params.id);
    },
  );

  app.post(
    "/contacts",
    { preHandler: requireTenantPermission("contacts.manage") },
    async (request, reply) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const body = parseRequestInput(createContactSchema, request.body);
      const contact = await createContact(
        tenant.id,
        currentUser.user.id,
        body,
      );

      await reply.status(201).send(contact);
    },
  );

  app.patch(
    "/contacts/:id",
    { preHandler: requireTenantPermission("contacts.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(contactParamsSchema, request.params);
      const body = parseRequestInput(updateContactSchema, request.body);

      return updateContact(tenant.id, currentUser.user.id, params.id, body);
    },
  );
}
