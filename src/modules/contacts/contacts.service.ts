import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";

import { getDatabase, type AppDatabase } from "../../db/client.ts";
import {
  auditLogs,
  contactRoles,
  contacts,
  contactWhatsappIdentities,
  whatsappContacts,
} from "../../db/schema.ts";
import { AppError } from "../../lib/app-error.ts";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "../../lib/pagination.ts";
import type {
  ContactListQuery,
  ContactRoleInput,
  CreateContactInput,
  UpdateContactInput,
} from "./contacts.schemas.ts";

type ContactRecord = typeof contacts.$inferSelect;
type ContactRoleRecord = typeof contactRoles.$inferSelect;
type DatabaseExecutor = Pick<AppDatabase, "delete" | "insert" | "select">;

type ContactRoleDto = {
  id: string;
  role: ContactRoleInput;
  contextType: string | null;
  contextId: string | null;
  createdAt: string;
};

type ContactWhatsappIdentityDto = {
  id: string;
  whatsappContactId: string;
  whatsappAccountId: string;
  externalContactId: string;
  phoneNumber: string | null;
  displayName: string | null;
  createdAt: string;
};

type ContactDto = {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  notes: string | null;
  roles: ContactRoleDto[];
  whatsappIdentities: ContactWhatsappIdentityDto[];
  createdAt: string;
  updatedAt: string;
};

type ContactListResult = {
  items: ContactDto[];
  pageInfo: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type ContactUpdateValues = {
  displayName?: string;
  phoneNumber?: string | null;
  notes?: string | null;
  updatedAt: Date;
};

function combineConditions(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) {
    return undefined;
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return and(...conditions);
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toRoleDto(roleAssignment: ContactRoleRecord): ContactRoleDto {
  return {
    id: roleAssignment.id,
    role: roleAssignment.role,
    contextType: roleAssignment.contextType,
    contextId: roleAssignment.contextId,
    createdAt: toIsoDate(roleAssignment.createdAt),
  };
}

function toWhatsappIdentityDto(identity: {
  id: string;
  whatsappContactId: string;
  whatsappAccountId: string;
  externalContactId: string;
  phoneNumber: string | null;
  displayName: string | null;
  createdAt: Date;
}): ContactWhatsappIdentityDto {
  return {
    id: identity.id,
    whatsappContactId: identity.whatsappContactId,
    whatsappAccountId: identity.whatsappAccountId,
    externalContactId: identity.externalContactId,
    phoneNumber: identity.phoneNumber,
    displayName: identity.displayName,
    createdAt: toIsoDate(identity.createdAt),
  };
}

function toContactDto(
  contact: ContactRecord,
  roleAssignments: ContactRoleRecord[],
  whatsappIdentities: ContactWhatsappIdentityDto[],
): ContactDto {
  return {
    id: contact.id,
    displayName: contact.displayName,
    phoneNumber: contact.phoneNumber,
    notes: contact.notes,
    roles: roleAssignments.map(toRoleDto),
    whatsappIdentities,
    createdAt: toIsoDate(contact.createdAt),
    updatedAt: toIsoDate(contact.updatedAt),
  };
}

function normalizePhoneNumber(phoneNumber: string | null | undefined): string {
  return phoneNumber?.replace(/\D/g, "") ?? "";
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

async function loadRolesByContactId(
  tenantId: string,
  contactIds: string[],
): Promise<Map<string, ContactRoleRecord[]>> {
  const rolesByContactId = new Map<string, ContactRoleRecord[]>();

  if (contactIds.length === 0) {
    return rolesByContactId;
  }

  const db = getDatabase();
  const roleRows = await db
    .select()
    .from(contactRoles)
    .where(
      and(
        eq(contactRoles.tenantId, tenantId),
        inArray(contactRoles.contactId, contactIds),
      ),
    )
    .orderBy(desc(contactRoles.createdAt), desc(contactRoles.id));

  for (const roleRow of roleRows) {
    const existingRoles = rolesByContactId.get(roleRow.contactId) ?? [];
    existingRoles.push(roleRow);
    rolesByContactId.set(roleRow.contactId, existingRoles);
  }

  return rolesByContactId;
}

async function loadWhatsappIdentitiesByContactId(
  tenantId: string,
  contactIds: string[],
): Promise<Map<string, ContactWhatsappIdentityDto[]>> {
  const identitiesByContactId = new Map<string, ContactWhatsappIdentityDto[]>();

  if (contactIds.length === 0) {
    return identitiesByContactId;
  }

  const db = getDatabase();
  const identityRows = await db
    .select({
      contactId: contactWhatsappIdentities.contactId,
      id: contactWhatsappIdentities.id,
      whatsappContactId: contactWhatsappIdentities.whatsappContactId,
      whatsappAccountId: whatsappContacts.whatsappAccountId,
      externalContactId: whatsappContacts.externalContactId,
      phoneNumber: whatsappContacts.phoneNumber,
      displayName: whatsappContacts.displayName,
      createdAt: contactWhatsappIdentities.createdAt,
    })
    .from(contactWhatsappIdentities)
    .innerJoin(
      whatsappContacts,
      and(
        eq(whatsappContacts.tenantId, tenantId),
        eq(whatsappContacts.id, contactWhatsappIdentities.whatsappContactId),
      ),
    )
    .where(
      and(
        eq(contactWhatsappIdentities.tenantId, tenantId),
        inArray(contactWhatsappIdentities.contactId, contactIds),
      ),
    )
    .orderBy(desc(contactWhatsappIdentities.createdAt));

  for (const identityRow of identityRows) {
    const existingIdentities =
      identitiesByContactId.get(identityRow.contactId) ?? [];
    existingIdentities.push(toWhatsappIdentityDto(identityRow));
    identitiesByContactId.set(identityRow.contactId, existingIdentities);
  }

  return identitiesByContactId;
}

async function resolveWhatsappContactIdsForContact(
  executor: DatabaseExecutor,
  tenantId: string,
  phoneNumber: string | null | undefined,
  whatsappExternalContactIds: string[],
): Promise<string[]> {
  const whatsappContactIds = new Set<string>();
  const externalContactIds = uniqueNonEmpty(whatsappExternalContactIds);

  if (externalContactIds.length > 0) {
    const rows = await executor
      .select({ id: whatsappContacts.id })
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.tenantId, tenantId),
          inArray(whatsappContacts.externalContactId, externalContactIds),
        ),
      );

    for (const row of rows) {
      whatsappContactIds.add(row.id);
    }
  }

  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

  if (normalizedPhoneNumber) {
    const rows = await executor
      .select({
        id: whatsappContacts.id,
        phoneNumber: whatsappContacts.phoneNumber,
      })
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.tenantId, tenantId),
          isNotNull(whatsappContacts.phoneNumber),
        ),
      );

    for (const row of rows) {
      if (normalizePhoneNumber(row.phoneNumber) === normalizedPhoneNumber) {
        whatsappContactIds.add(row.id);
      }
    }
  }

  return Array.from(whatsappContactIds);
}

async function replaceContactWhatsappIdentities(
  executor: DatabaseExecutor,
  tenantId: string,
  contactId: string,
  phoneNumber: string | null | undefined,
  whatsappExternalContactIds: string[],
): Promise<void> {
  const nextWhatsappContactIds = await resolveWhatsappContactIdsForContact(
    executor,
    tenantId,
    phoneNumber,
    whatsappExternalContactIds,
  );
  const nextWhatsappContactIdSet = new Set(nextWhatsappContactIds);

  const existingRows = await executor
    .select({ whatsappContactId: contactWhatsappIdentities.whatsappContactId })
    .from(contactWhatsappIdentities)
    .where(
      and(
        eq(contactWhatsappIdentities.tenantId, tenantId),
        eq(contactWhatsappIdentities.contactId, contactId),
      ),
    );
  const staleWhatsappContactIds = existingRows
    .map((row) => row.whatsappContactId)
    .filter((whatsappContactId) => !nextWhatsappContactIdSet.has(whatsappContactId));

  if (staleWhatsappContactIds.length > 0) {
    await executor
      .delete(contactWhatsappIdentities)
      .where(
        and(
          eq(contactWhatsappIdentities.tenantId, tenantId),
          eq(contactWhatsappIdentities.contactId, contactId),
          inArray(
            contactWhatsappIdentities.whatsappContactId,
            staleWhatsappContactIds,
          ),
        ),
      );
  }

  if (nextWhatsappContactIds.length === 0) {
    return;
  }

  await executor
    .insert(contactWhatsappIdentities)
    .values(
      nextWhatsappContactIds.map((whatsappContactId) => ({
        tenantId,
        contactId,
        whatsappContactId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        contactWhatsappIdentities.tenantId,
        contactWhatsappIdentities.whatsappContactId,
      ],
      set: { contactId },
    });
}

async function findContactForTenant(
  tenantId: string,
  contactId: string,
): Promise<ContactRecord> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.tenantId, tenantId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);

  const contact = rows[0];

  if (!contact) {
    throw new AppError({
      code: "CONTACT_NOT_FOUND",
      message: "Contact was not found.",
      statusCode: 404,
    });
  }

  return contact;
}

async function findContactIdsByRole(
  tenantId: string,
  role: ContactRoleInput,
): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .select({ contactId: contactRoles.contactId })
    .from(contactRoles)
    .where(and(eq(contactRoles.tenantId, tenantId), eq(contactRoles.role, role)));

  return Array.from(new Set(rows.map((roleRow) => roleRow.contactId)));
}

export async function listContacts(
  tenantId: string,
  query: ContactListQuery,
): Promise<ContactListResult> {
  const db = getDatabase();
  const conditions: SQL[] = [
    eq(contacts.tenantId, tenantId),
    isNull(contacts.deletedAt),
  ];

  if (query.role) {
    const roleContactIds = await findContactIdsByRole(tenantId, query.role);

    if (roleContactIds.length === 0) {
      return {
        items: [],
        pageInfo: {
          limit: query.limit,
          nextCursor: null,
          hasMore: false,
        },
      };
    }

    conditions.push(inArray(contacts.id, roleContactIds));
  }

  if (query.search) {
    const searchPattern = `%${query.search}%`;
    const searchCondition = or(
      ilike(contacts.displayName, searchPattern),
      ilike(contacts.phoneNumber, searchPattern),
      ilike(contacts.notes, searchPattern),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (query.cursor) {
    const cursor = decodeDateIdCursor(query.cursor);
    const cursorCondition = or(
      lt(contacts.createdAt, cursor.createdAt),
      and(eq(contacts.createdAt, cursor.createdAt), lt(contacts.id, cursor.id)),
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await db
    .select()
    .from(contacts)
    .where(combineConditions(conditions))
    .orderBy(desc(contacts.createdAt), desc(contacts.id))
    .limit(query.limit + 1);

  const pageRows = rows.slice(0, query.limit);
  const nextRow = rows[query.limit];
  const cursorRow = pageRows[pageRows.length - 1];
  const roleAssignmentsByContactId = await loadRolesByContactId(
    tenantId,
    pageRows.map((contact) => contact.id),
  );
  const whatsappIdentitiesByContactId = await loadWhatsappIdentitiesByContactId(
    tenantId,
    pageRows.map((contact) => contact.id),
  );

  return {
    items: pageRows.map((contact) =>
      toContactDto(
        contact,
        roleAssignmentsByContactId.get(contact.id) ?? [],
        whatsappIdentitiesByContactId.get(contact.id) ?? [],
      ),
    ),
    pageInfo: {
      limit: query.limit,
      nextCursor: nextRow && cursorRow
        ? encodeDateIdCursor({
            createdAt: cursorRow.createdAt,
            id: cursorRow.id,
          })
        : null,
      hasMore: nextRow !== undefined,
    },
  };
}

export async function getContact(
  tenantId: string,
  contactId: string,
): Promise<ContactDto> {
  const contact = await findContactForTenant(tenantId, contactId);
  const rolesByContactId = await loadRolesByContactId(tenantId, [contact.id]);
  const whatsappIdentitiesByContactId = await loadWhatsappIdentitiesByContactId(
    tenantId,
    [contact.id],
  );

  return toContactDto(
    contact,
    rolesByContactId.get(contact.id) ?? [],
    whatsappIdentitiesByContactId.get(contact.id) ?? [],
  );
}

export async function createContact(
  tenantId: string,
  actorUserId: string,
  input: CreateContactInput,
): Promise<ContactDto> {
  const db = getDatabase();

  const createdContact = await db.transaction(async (transaction) => {
    const contactRows = await transaction
      .insert(contacts)
      .values({
        tenantId,
        displayName: input.displayName,
        phoneNumber: input.phoneNumber,
        notes: input.notes,
      })
      .returning();

    const contact = contactRows[0];

    if (!contact) {
      throw new AppError({
        code: "CONTACT_CREATE_FAILED",
        message: "Contact could not be created.",
        statusCode: 500,
      });
    }

    if (input.roles.length > 0) {
      await transaction.insert(contactRoles).values(
        input.roles.map((role) => ({
          tenantId,
          contactId: contact.id,
          role,
        })),
      );
    }

    await replaceContactWhatsappIdentities(
      transaction,
      tenantId,
      contact.id,
      contact.phoneNumber,
      input.whatsappExternalContactIds,
    );

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "contact.created",
      entityType: "contact",
      entityId: contact.id,
      metadata: {
        assignedRoles: input.roles,
        whatsappExternalContactIds: input.whatsappExternalContactIds,
      },
    });

    return contact;
  });

  const rolesByContactId = await loadRolesByContactId(tenantId, [
    createdContact.id,
  ]);
  const whatsappIdentitiesByContactId = await loadWhatsappIdentitiesByContactId(
    tenantId,
    [createdContact.id],
  );

  return toContactDto(
    createdContact,
    rolesByContactId.get(createdContact.id) ?? [],
    whatsappIdentitiesByContactId.get(createdContact.id) ?? [],
  );
}

export async function updateContact(
  tenantId: string,
  actorUserId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<ContactDto> {
  await findContactForTenant(tenantId, contactId);

  const db = getDatabase();
  const updatedAt = new Date();
  const updateValues: ContactUpdateValues = { updatedAt };
  const changedFields: string[] = [];

  if (input.displayName !== undefined) {
    updateValues.displayName = input.displayName;
    changedFields.push("displayName");
  }

  if (input.phoneNumber !== undefined) {
    updateValues.phoneNumber = input.phoneNumber;
    changedFields.push("phoneNumber");
  }

  if (input.notes !== undefined) {
    updateValues.notes = input.notes;
    changedFields.push("notes");
  }

  if (input.roles !== undefined) {
    changedFields.push("roles");
  }

  if (input.whatsappExternalContactIds !== undefined) {
    changedFields.push("whatsappExternalContactIds");
  }

  const updatedContact = await db.transaction(async (transaction) => {
    const contactRows = await transaction
      .update(contacts)
      .set(updateValues)
      .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
      .returning();

    const contact = contactRows[0];

    if (!contact) {
      throw new AppError({
        code: "CONTACT_UPDATE_FAILED",
        message: "Contact could not be updated.",
        statusCode: 500,
      });
    }

    if (input.roles !== undefined) {
      await transaction
        .delete(contactRoles)
        .where(
          and(
            eq(contactRoles.tenantId, tenantId),
            eq(contactRoles.contactId, contactId),
            isNull(contactRoles.contextType),
            isNull(contactRoles.contextId),
          ),
        );

      if (input.roles.length > 0) {
        await transaction.insert(contactRoles).values(
          input.roles.map((role) => ({
            tenantId,
            contactId,
            role,
          })),
        );
      }
    }

    if (
      input.phoneNumber !== undefined ||
      input.whatsappExternalContactIds !== undefined
    ) {
      const existingIdentities = await loadWhatsappIdentitiesByContactId(
        tenantId,
        [contactId],
      );
      await replaceContactWhatsappIdentities(
        transaction,
        tenantId,
        contactId,
        contact.phoneNumber,
        input.whatsappExternalContactIds ??
          (existingIdentities
            .get(contactId)
            ?.map((identity) => identity.externalContactId) ??
            []),
      );
    }

    await transaction.insert(auditLogs).values({
      tenantId,
      actorUserId,
      action: "contact.updated",
      entityType: "contact",
      entityId: contactId,
      metadata: {
        changedFields,
        replacedTenantWideRoles: input.roles !== undefined,
      },
    });

    return contact;
  });

  const rolesByContactId = await loadRolesByContactId(tenantId, [contactId]);
  const whatsappIdentitiesByContactId = await loadWhatsappIdentitiesByContactId(
    tenantId,
    [contactId],
  );

  return toContactDto(
    updatedContact,
    rolesByContactId.get(contactId) ?? [],
    whatsappIdentitiesByContactId.get(contactId) ?? [],
  );
}
