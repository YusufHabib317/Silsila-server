import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";

import { AppError } from "../../lib/app-error.ts";
import {
  getCurrentUserByToken,
  sessionCookieName,
  type CurrentUserResult,
  type TenantMembership,
} from "./auth.service.ts";
import {
  roleHasPermission,
  type TenantPermission,
} from "./permissions.ts";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUserResult;
    currentTenant?: TenantMembership;
  }
}

function getSingleHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function resolveTenantMembership(
  request: FastifyRequest,
  currentUser: CurrentUserResult,
): TenantMembership {
  const requestedTenantId = getSingleHeaderValue(request.headers["x-tenant-id"]);

  if (!requestedTenantId && currentUser.tenants.length === 1) {
    const onlyTenant = currentUser.tenants[0];

    if (!onlyTenant) {
      throw new AppError({
        code: "TENANT_REQUIRED",
        message: "A tenant is required for this resource.",
        statusCode: 400,
      });
    }

    return onlyTenant;
  }

  if (!requestedTenantId) {
    throw new AppError({
      code: "TENANT_REQUIRED",
      message: "Send x-tenant-id to choose which tenant to access.",
      statusCode: 400,
    });
  }

  const membership = currentUser.tenants.find(
    (tenant) => tenant.id === requestedTenantId,
  );

  if (!membership) {
    throw new AppError({
      code: "TENANT_ACCESS_DENIED",
      message: "You do not have access to this tenant.",
      statusCode: 403,
    });
  }

  return membership;
}

async function loadAuthenticatedUser(
  request: FastifyRequest,
): Promise<CurrentUserResult> {
  const currentUser = await getCurrentUserByToken(
    request.cookies[sessionCookieName],
  );

  if (!currentUser) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "You must be logged in to access this resource.",
      statusCode: 401,
    });
  }

  request.currentUser = currentUser;

  return currentUser;
}

export const requireAuth: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  await loadAuthenticatedUser(request);
};

export const requirePlatformAdmin: preHandlerAsyncHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> => {
  const currentUser = await loadAuthenticatedUser(request);

  if (!currentUser.isPlatformAdmin) {
    throw new AppError({
      code: "PLATFORM_ADMIN_REQUIRED",
      message: "Platform admin access is required.",
      statusCode: 403,
    });
  }
};

export function requireTenantPermission(
  permission: TenantPermission,
): preHandlerAsyncHookHandler {
  return async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    const currentUser = await loadAuthenticatedUser(request);
    const tenant = resolveTenantMembership(request, currentUser);

    if (!roleHasPermission(tenant.role, permission)) {
      throw new AppError({
        code: "PERMISSION_DENIED",
        message: `Permission ${permission} is required.`,
        statusCode: 403,
      });
    }

    request.currentTenant = tenant;
  };
}

export function getCurrentTenant(request: FastifyRequest): TenantMembership {
  if (!request.currentTenant) {
    throw new AppError({
      code: "TENANT_REQUIRED",
      message: "A tenant is required for this resource.",
      statusCode: 400,
    });
  }

  return request.currentTenant;
}

export function getCurrentUser(request: FastifyRequest): CurrentUserResult {
  if (!request.currentUser) {
    throw new AppError({
      code: "AUTHENTICATION_REQUIRED",
      message: "You must be logged in to access this resource.",
      statusCode: 401,
    });
  }

  return request.currentUser;
}
