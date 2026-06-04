import type { z } from "zod";

import { AppError } from "./app-error.ts";

export function parseRequestInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      statusCode: 400,
      details: result.error.flatten(),
    });
  }

  return result.data;
}
