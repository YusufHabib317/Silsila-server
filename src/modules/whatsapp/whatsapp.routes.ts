import type { FastifyInstance } from "fastify";

import { parseRequestInput } from "../../lib/validation.ts";
import {
  getCurrentTenant,
  getCurrentUser,
  requireTenantPermission,
} from "../auth/auth.middleware.ts";
import {
  createWhatsappAccountSchema,
  trackedSourceParamsSchema,
  upsertTrackedSourceSchema,
  whatsappAccountParamsSchema,
  whatsappAccountListQuerySchema,
  whatsappChatListQuerySchema,
  whatsappMessageListQuerySchema,
  whatsappMessageParamsSchema,
} from "./whatsapp.schemas.ts";
import {
  createWhatsappAccount,
  getWhatsappAccount,
  getWhatsappMessage,
  listWhatsappAccounts,
  listWhatsappChats,
  listWhatsappMessages,
  requestWhatsappAccountConnection,
  requestWhatsappAccountDisconnect,
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

  app.post(
    "/whatsapp/accounts",
    { preHandler: requireTenantPermission("settings.whatsapp.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const body = parseRequestInput(createWhatsappAccountSchema, request.body);

      return createWhatsappAccount(tenant.id, currentUser.user.id, body);
    },
  );

  app.get(
    "/whatsapp/accounts/:id",
    { preHandler: requireTenantPermission("settings.whatsapp.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const params = parseRequestInput(whatsappAccountParamsSchema, request.params);

      return getWhatsappAccount(tenant.id, params.id);
    },
  );

  app.post(
    "/whatsapp/accounts/:id/connect",
    { preHandler: requireTenantPermission("settings.whatsapp.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(whatsappAccountParamsSchema, request.params);

      return requestWhatsappAccountConnection(
        tenant.id,
        currentUser.user.id,
        params.id,
      );
    },
  );

  app.post(
    "/whatsapp/accounts/:id/disconnect",
    { preHandler: requireTenantPermission("settings.whatsapp.manage") },
    async (request) => {
      const tenant = getCurrentTenant(request);
      const currentUser = getCurrentUser(request);
      const params = parseRequestInput(whatsappAccountParamsSchema, request.params);

      return requestWhatsappAccountDisconnect(
        tenant.id,
        currentUser.user.id,
        params.id,
      );
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
