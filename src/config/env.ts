import { z } from "zod";

const booleanStringSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CLEANUP_WORKER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .default(300_000),
    WHATSAPP_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .default(5_000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001,http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z.string().optional(),
    ENCRYPTION_KEY: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),
    TRUST_PROXY: booleanStringSchema.default(false),
  })
  .transform((env) => ({
    ...env,
    R2_BUCKET_NAME: env.R2_BUCKET_NAME ?? env.R2_BUCKET,
  }))
  .superRefine((env, context) => {
    if (env.NODE_ENV !== "production") {
      return;
    }

    const requiredProductionValues = [
      ["DATABASE_URL", env.DATABASE_URL],
      ["SESSION_SECRET", env.SESSION_SECRET],
      ["ENCRYPTION_KEY", env.ENCRYPTION_KEY],
      ["R2_ACCOUNT_ID", env.R2_ACCOUNT_ID],
      ["R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID],
      ["R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY],
      ["R2_BUCKET_NAME", env.R2_BUCKET_NAME],
      ["R2_ENDPOINT", env.R2_ENDPOINT],
    ] as const;

    for (const [key, value] of requiredProductionValues) {
      if (!value) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production.`,
        });
      }
    }

    if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters in production.",
      });
    }

    if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message: "ENCRYPTION_KEY must be at least 32 characters in production.",
      });
    }

    if (env.CORS_ORIGINS.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS must contain at least one origin in production.",
      });
    }

    if (env.CORS_ORIGINS.includes("*")) {
      context.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS cannot include wildcard origins in production.",
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration", parsedEnv.error.flatten());
  process.exit(1);
}

export const env = parsedEnv.data;

export type AppEnv = typeof env;
