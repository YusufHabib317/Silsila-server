import type { FastifyInstance, FastifyReply } from "fastify";

import { env } from "../../config/env.ts";
import { parseRequestInput } from "../../lib/validation.ts";
import {
  clearCsrfCookie,
  createCsrfToken,
  setCsrfCookie,
} from "../../plugins/csrf.ts";
import { requireAuth } from "./auth.middleware.ts";
import { loginSchema, registerSchema } from "./auth.schemas.ts";
import {
  login,
  logout,
  registerTenantOwner,
  sessionCookieName,
  type AuthResult,
} from "./auth.service.ts";

function setSessionCookie(reply: FastifyReply, auth: AuthResult): void {
  reply.setCookie(sessionCookieName, auth.session.token, {
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: auth.session.expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, {
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

function toAuthResponse(
  auth: AuthResult,
  csrfToken: string,
): {
  user: AuthResult["user"];
  tenants: AuthResult["tenants"];
  isPlatformAdmin: boolean;
  sessionExpiresAt: string;
  csrfToken: string;
} {
  return {
    user: auth.user,
    tenants: auth.tenants,
    isPlatformAdmin: auth.isPlatformAdmin,
    sessionExpiresAt: auth.session.expiresAt.toISOString(),
    csrfToken,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/csrf", async (_request, reply) => {
    const csrfToken = createCsrfToken();
    setCsrfCookie(reply, csrfToken);

    await reply.send({
      csrfToken,
    });
  });

  app.post("/auth/register", async (request, reply) => {
    const body = parseRequestInput(registerSchema, request.body);
    const auth = await registerTenantOwner(body);
    const csrfToken = createCsrfToken();

    setSessionCookie(reply, auth);
    setCsrfCookie(reply, csrfToken);

    await reply.status(201).send(toAuthResponse(auth, csrfToken));
  });

  app.post("/auth/login", async (request, reply) => {
    const body = parseRequestInput(loginSchema, request.body);
    const auth = await login(body);
    const csrfToken = createCsrfToken();

    setSessionCookie(reply, auth);
    setCsrfCookie(reply, csrfToken);

    await reply.send(toAuthResponse(auth, csrfToken));
  });

  app.post("/auth/logout", async (request, reply) => {
    await logout(request.cookies[sessionCookieName]);
    clearSessionCookie(reply);
    clearCsrfCookie(reply);

    await reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => request.currentUser);
}
