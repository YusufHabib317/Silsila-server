import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { env } from "./config/env.ts";
import { isAppError } from "./lib/app-error.ts";
import { registerCsrfProtection } from "./plugins/csrf.ts";
import { registerCorePlugins } from "./plugins/security.ts";
import { registerRoutes } from "./routes/index.ts";

function createRequestId(): string {
  return crypto.randomUUID();
}

function getErrorStatusCode(error: FastifyError): number {
  if (isAppError(error)) {
    return error.statusCode;
  }

  return typeof error.statusCode === "number" ? error.statusCode : 500;
}

function getSafeErrorMessage(statusCode: number, error: FastifyError): string {
  if (isAppError(error)) {
    return error.message;
  }

  if (statusCode >= 500) {
    return "Internal server error";
  }

  return error.message;
}

async function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const statusCode = getErrorStatusCode(error);

  request.log.error(
    {
      err: error,
      requestId: request.id,
      statusCode,
    },
    "Request failed",
  );

  await reply.status(statusCode).send({
    error: {
      code: isAppError(error)
        ? error.code
        : error.code ?? "INTERNAL_SERVER_ERROR",
      message: getSafeErrorMessage(statusCode, error),
      requestId: request.id,
      details: isAppError(error) ? error.details : undefined,
    },
  });
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    genReqId: createRequestId,
    trustProxy: env.TRUST_PROXY,
  });

  app.setErrorHandler(handleError);

  await registerCorePlugins(app);
  await registerCsrfProtection(app);
  await registerRoutes(app);

  return app;
}
