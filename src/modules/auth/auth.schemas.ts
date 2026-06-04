import { z } from "zod";

const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200, "Password is too long.");

export const registerSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.toLowerCase()),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(160),
  tenantName: z.string().trim().min(1).max(180),
});

export const loginSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
