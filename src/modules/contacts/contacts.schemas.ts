import { z } from "zod";

export const contactRoleValues = [
  "merchant",
  "agent",
  "customer",
  "supplier",
  "factory",
  "internal",
  "unknown",
] as const;

const tenantWideRolesSchema = z
  .array(z.enum(contactRoleValues))
  .max(contactRoleValues.length)
  .transform((roles) => Array.from(new Set(roles)));

const optionalTextSchema = z.string().trim().min(1).max(5000);
const whatsappExternalContactIdsSchema = z
  .array(z.string().trim().min(1).max(240))
  .max(20)
  .transform((values) => Array.from(new Set(values)));

export const contactParamsSchema = z.object({
  id: z.string().uuid(),
});

export const contactListQuerySchema = z.object({
  role: z.enum(contactRoleValues).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

export const createContactSchema = z.object({
  displayName: z.string().trim().min(1).max(180),
  phoneNumber: z.string().trim().min(1).max(40).optional(),
  notes: optionalTextSchema.optional(),
  roles: tenantWideRolesSchema.default([]),
  whatsappExternalContactIds: whatsappExternalContactIdsSchema.default([]),
});

export const updateContactSchema = z
  .object({
    displayName: z.string().trim().min(1).max(180).optional(),
    phoneNumber: z.string().trim().min(1).max(40).nullable().optional(),
    notes: optionalTextSchema.nullable().optional(),
    roles: tenantWideRolesSchema.optional(),
    whatsappExternalContactIds: whatsappExternalContactIdsSchema.optional(),
  })
  .refine(
    (input) =>
      input.displayName !== undefined ||
      input.phoneNumber !== undefined ||
      input.notes !== undefined ||
      input.roles !== undefined ||
      input.whatsappExternalContactIds !== undefined,
    {
      message: "At least one contact field must be provided.",
    },
  );

export type ContactRoleInput = (typeof contactRoleValues)[number];
export type ContactListQuery = z.infer<typeof contactListQuerySchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
