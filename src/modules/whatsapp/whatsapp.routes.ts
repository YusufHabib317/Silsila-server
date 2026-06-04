import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  trackedSourceParamsSchema,
  upsertTrackedSourceSchema,
  whatsappAccountListQuerySchema,
  whatsappChatListQuerySchema,
  whatsappMessageListQuerySchema,
  whatsappMessageParamsSchema,
} from "./whatsapp.schemas.ts";
import {
  getWhatsappMessage,
  listWhatsappAccounts,
  listWhatsappChats,
  listWhatsappMessages,
  upsertTrackedSource,
} from "./whatsapp.service.ts";

export async function registerWhatsappRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/whatsapp/accounts",
    { preHandler: requireTenantPermission("settings.whatsapp.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(
        whatsappAccountListQuerySchema,
        request.query,
      );

      return listWhatsappAccounts(tenant.id, query);
    },
  );

  app.get(
    "/whatsapp/chats",
    { preHandler: requireTenantPermission("settings.tracking.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(whatsappChatListQuerySchema, request.query);

      return listWhatsappChats(tenant.id, query);
    },
  );

  app.put(
    "/tracked-sources/:chatId",
    { preHandler: requireTenantPermission("settings.tracking.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(trackedSourceParamsSchema, request.params);
      const body = parseRequestInput(upsertTrackedSourceSchema, request.body);

      return upsertTrackedSource(
        tenant.id,
        currentUser.user.id,
        params.chatId,
        body,
      );
    },
  );

  app.get(
    "/whatsapp/messages",
    { preHandler: requireTenantPermission("inbox.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const query = parseRequestInput(
        whatsappMessageListQuerySchema,
        request.query,
      );

      return listWhatsappMessages(tenant.id, query);
    },
  );

  app.get(
    "/whatsapp/messages/:id",
    { preHandler: requireTenantPermission("inbox.read") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(whatsappMessageParamsSchema, request.params);

      return getWhatsappMessage(tenant.id, params.id);
    },
  );
}
