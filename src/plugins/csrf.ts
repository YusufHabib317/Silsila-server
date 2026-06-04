import { randomBytes, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";

import { env } from "../config/env.ts";
import { AppError } from "../lib/app-error.ts";

export const csrfCookieName = "wa_commerce_csrf";
export const csrfHeaderName = "x-csrf-token";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function setCsrfCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(csrfCookieName, token, {
    path: "/",
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

export function clearCsrfCookie(reply: FastifyReply): void {
  reply.clearCookie(csrfCookieName, {
    path: "/",
    httpOnly: false,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function tokensMatch(headerToken: string, cookieToken: string): boolean {
  const headerBuffer = Buffer.from(headerToken);
  const cookieBuffer = Buffer.from(cookieToken);

  if (headerBuffer.length !== cookieBuffer.length) {
    return false;
  }

  return timingSafeEqual(headerBuffer, cookieBuffer);
}

export async function registerCsrfProtection(
  app: FastifyInstance,
): Promise<void> {
  app.addHook("preHandler", async (request) => {
    if (!unsafeMethods.has(request.method)) {
      return;
    }

    const headerToken = getHeaderValue(request.headers[csrfHeaderName]);
    const cookieToken = request.cookies[csrfCookieName];

    if (!headerToken || !cookieToken || !tokensMatch(headerToken, cookieToken)) {
      throw new AppError({
        code: "CSRF_TOKEN_INVALID",
        message: "A valid CSRF token is required for this request.",
        statusCode: 403,
      });
    }
  });
}
