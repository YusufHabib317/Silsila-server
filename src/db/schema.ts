import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => uuid("tenant_id").notNull();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

export const tenantStatusEnum = pgEnum("tenant_status", [
  "active",
  "trial",
  "disabled",
  "deleted",
]);

export const tenantPlanEnum = pgEnum("tenant_plan", [
  "free",
  "starter",
  "pro",
  "enterprise",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
  "deleted",
]);

export const tenantRoleEnum = pgEnum("tenant_role", [
  "owner",
  "manager",
  "agent",
  "viewer",
  "accountant",
]);

export const whatsappAccountStatusEnum = pgEnum("whatsapp_account_status", [
  "pending_qr",
  "qr_ready",
  "connecting",
  "connected",
  "disconnected",
  "reconnecting",
  "expired",
  "failed",
  "disabled",
]);

export const whatsappSourceTypeEnum = pgEnum("whatsapp_source_type", [
  "merchant_group",
  "agent_group",
  "customer_chat",
  "supplier_chat",
  "internal_team",
  "unknown",
]);

export const trackedSourceStatusEnum = pgEnum("tracked_source_status", [
  "tracked",
  "ignored",
  "personal",
]);

export const whatsappMessageTypeEnum = pgEnum("whatsapp_message_type", [
  "text",
  "image",
  "video",
  "audio",
  "voice",
  "document",
  "sticker",
  "location",
  "contact",
  "unknown",
]);

export const messageBundleStatusEnum = pgEnum("message_bundle_status", [
  "draft",
  "reviewed",
  "linked",
  "archived",
  "deleted",
]);

export const messageBundleTypeEnum = pgEnum("message_bundle_type", [
  "product",
  "order",
  "product_update",
  "order_update",
  "customer_request",
  "merchant_note",
  "unknown",
]);

export const productOwnerTypeEnum = pgEnum("product_owner_type", [
  "own_stock",
  "merchant_product",
  "factory_product",
  "agent_product",
  "unknown",
]);

export const productStatusEnum = pgEnum("product_status", [
  "draft",
  "active",
  "out_of_stock",
  "price_changed",
  "paused",
  "archived",
  "deleted",
]);

export const stockStatusEnum = pgEnum("stock_status", [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "unknown",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "needs_review",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "paid",
  "cancelled",
  "returned",
  "failed",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
  "refunded",
  "unknown",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "not_started",
  "preparing",
  "with_delivery",
  "delivered",
  "returned",
  "failed",
  "unknown",
]);

export const contactRoleEnum = pgEnum("contact_role", [
  "merchant",
  "agent",
  "customer",
  "supplier",
  "factory",
  "internal",
  "unknown",
]);

export const commissionTypeEnum = pgEnum("commission_type", [
  "fixed_amount",
  "percentage",
  "manual",
  "unknown",
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "approved",
  "paid",
  "cancelled",
]);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: varchar("name", { length: 180 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    status: tenantStatusEnum("status").notNull().default("trial"),
    plan: tenantPlanEnum("plan").notNull().default("free"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("tenants_slug_unique").on(table.slug),
    index("tenants_status_idx").on(table.status),
  ],
);

export const tenantUsers = pgTable(
  "tenant_users",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: tenantRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("tenant_users_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
    index("tenant_users_tenant_idx").on(table.tenantId),
    index("tenant_users_user_idx").on(table.userId),
    index("tenant_users_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (table) => [uniqueIndex("platform_admins_user_unique").on(table.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: uuid("tenant_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_logs_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_action_idx").on(table.action),
  ],
);

export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    phoneNumber: varchar("phone_number", { length: 40 }),
    displayName: varchar("display_name", { length: 160 }),
    status: whatsappAccountStatusEnum("status")
      .notNull()
      .default("pending_qr"),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    lastDisconnectedAt: timestamp("last_disconnected_at", {
      withTimezone: true,
    }),
    qrCode: text("qr_code"),
    qrExpiresAt: timestamp("qr_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("whatsapp_accounts_tenant_idx").on(table.tenantId),
    index("whatsapp_accounts_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
  ],
);

export const whatsappAuthStates = pgTable(
  "whatsapp_auth_states",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    keyType: varchar("key_type", { length: 80 }).notNull(),
    keyId: varchar("key_id", { length: 500 }).notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("whatsapp_auth_states_key_unique").on(
      table.tenantId,
      table.whatsappAccountId,
      table.keyType,
      table.keyId,
    ),
    index("whatsapp_auth_states_account_idx").on(
      table.tenantId,
      table.whatsappAccountId,
    ),
  ],
);

export const whatsappChats = pgTable(
  "whatsapp_chats",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    externalChatId: varchar("external_chat_id", { length: 240 }).notNull(),
    displayName: varchar("display_name", { length: 240 }),
    sourceType: whatsappSourceTypeEnum("source_type").notNull().default("unknown"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("whatsapp_chats_external_unique").on(
      table.tenantId,
      table.whatsappAccountId,
      table.externalChatId,
    ),
    index("whatsapp_chats_tenant_account_idx").on(
      table.tenantId,
      table.whatsappAccountId,
    ),
  ],
);

export const whatsappContacts = pgTable(
  "whatsapp_contacts",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    externalContactId: varchar("external_contact_id", { length: 240 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 40 }),
    displayName: varchar("display_name", { length: 180 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("whatsapp_contacts_external_unique").on(
      table.tenantId,
      table.whatsappAccountId,
      table.externalContactId,
    ),
    index("whatsapp_contacts_tenant_account_idx").on(
      table.tenantId,
      table.whatsappAccountId,
    ),
  ],
);

export const trackedSources = pgTable(
  "tracked_sources",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => whatsappChats.id),
    status: trackedSourceStatusEnum("status").notNull().default("tracked"),
    sourceType: whatsappSourceTypeEnum("source_type").notNull().default("unknown"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("tracked_sources_chat_unique").on(table.tenantId, table.chatId),
    index("tracked_sources_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => whatsappChats.id),
    senderContactId: uuid("sender_contact_id").references(
      () => whatsappContacts.id,
    ),
    externalMessageId: varchar("external_message_id", { length: 240 }).notNull(),
    messageType: whatsappMessageTypeEnum("message_type")
      .notNull()
      .default("unknown"),
    bodyText: text("body_text"),
    rawPayloadJson: jsonb("raw_payload_json").$type<unknown>().notNull(),
    isFromMe: boolean("is_from_me").notNull().default(false),
    isTracked: boolean("is_tracked").notNull().default(false),
    isLinked: boolean("is_linked").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    isPersonal: boolean("is_personal").notNull().default(false),
    isTemporary: boolean("is_temporary").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("whatsapp_messages_external_unique").on(
      table.tenantId,
      table.whatsappAccountId,
      table.externalMessageId,
    ),
    index("whatsapp_messages_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    index("whatsapp_messages_tenant_expires_idx").on(
      table.tenantId,
      table.expiresAt,
    ),
    index("whatsapp_messages_tenant_chat_idx").on(table.tenantId, table.chatId),
    index("whatsapp_messages_tenant_flags_idx").on(
      table.tenantId,
      table.isTracked,
      table.isLinked,
      table.isArchived,
    ),
  ],
);

export const mediaObjects = pgTable(
  "media_objects",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappMessageId: uuid("whatsapp_message_id").references(
      () => whatsappMessages.id,
    ),
    ownerType: varchar("owner_type", { length: 60 }).notNull(),
    ownerId: uuid("owner_id"),
    bucket: varchar("bucket", { length: 180 }).notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: varchar("mime_type", { length: 180 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageClass: varchar("storage_class", { length: 40 }).notNull(),
    isTemporary: boolean("is_temporary").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("media_objects_object_key_unique").on(table.bucket, table.objectKey),
    index("media_objects_tenant_expires_idx").on(table.tenantId, table.expiresAt),
    index("media_objects_tenant_owner_idx").on(
      table.tenantId,
      table.ownerType,
      table.ownerId,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    displayName: varchar("display_name", { length: 180 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 40 }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("contacts_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("contacts_tenant_phone_idx").on(table.tenantId, table.phoneNumber),
  ],
);

export const contactRoles = pgTable(
  "contact_roles",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    role: contactRoleEnum("role").notNull(),
    contextType: varchar("context_type", { length: 60 }),
    contextId: uuid("context_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("contact_roles_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("contact_roles_tenant_role_idx").on(table.tenantId, table.role),
  ],
);

export const contactWhatsappIdentities = pgTable(
  "contact_whatsapp_identities",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    whatsappContactId: uuid("whatsapp_contact_id")
      .notNull()
      .references(() => whatsappContacts.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("contact_whatsapp_identities_unique").on(
      table.tenantId,
      table.whatsappContactId,
    ),
    index("contact_whatsapp_identities_contact_idx").on(
      table.tenantId,
      table.contactId,
    ),
  ],
);

export const messageBundles = pgTable(
  "message_bundles",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    sourceChatId: uuid("source_chat_id")
      .notNull()
      .references(() => whatsappChats.id),
    title: varchar("title", { length: 220 }).notNull(),
    status: messageBundleStatusEnum("status").notNull().default("draft"),
    bundleType: messageBundleTypeEnum("bundle_type").notNull().default("unknown"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("message_bundles_tenant_status_idx").on(table.tenantId, table.status),
    index("message_bundles_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export const messageBundleItems = pgTable(
  "message_bundle_items",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => messageBundles.id),
    whatsappMessageId: uuid("whatsapp_message_id")
      .notNull()
      .references(() => whatsappMessages.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("message_bundle_items_message_unique").on(
      table.tenantId,
      table.bundleId,
      table.whatsappMessageId,
    ),
    index("message_bundle_items_bundle_idx").on(table.tenantId, table.bundleId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    name: varchar("name", { length: 220 }).notNull(),
    description: text("description"),
    categoryId: uuid("category_id"),
    ownerType: productOwnerTypeEnum("owner_type").notNull().default("unknown"),
    ownerContactId: uuid("owner_contact_id").references(() => contacts.id),
    merchantContactId: uuid("merchant_contact_id").references(() => contacts.id),
    sourceBundleId: uuid("source_bundle_id").references(() => messageBundles.id),
    costAmountMinor: integer("cost_amount_minor"),
    saleAmountMinor: integer("sale_amount_minor"),
    agentAmountMinor: integer("agent_amount_minor"),
    currency: varchar("currency", { length: 3 }).notNull().default("SYP"),
    stockStatus: stockStatusEnum("stock_status").notNull().default("unknown"),
    productStatus: productStatusEnum("product_status").notNull().default("draft"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("products_tenant_status_idx").on(table.tenantId, table.productStatus),
    index("products_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("products_tenant_merchant_idx").on(table.tenantId, table.merchantContactId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    orderNumber: varchar("order_number", { length: 80 }).notNull(),
    customerContactId: uuid("customer_contact_id").references(() => contacts.id),
    merchantContactId: uuid("merchant_contact_id").references(() => contacts.id),
    agentContactId: uuid("agent_contact_id").references(() => contacts.id),
    sourceBundleId: uuid("source_bundle_id").references(() => messageBundles.id),
    status: orderStatusEnum("status").notNull().default("new"),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unknown"),
    deliveryStatus: deliveryStatusEnum("delivery_status")
      .notNull()
      .default("unknown"),
    totalAmountMinor: integer("total_amount_minor"),
    currency: varchar("currency", { length: 3 }).notNull().default("SYP"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("orders_tenant_order_number_unique").on(
      table.tenantId,
      table.orderNumber,
    ),
    index("orders_tenant_status_idx").on(table.tenantId, table.status),
    index("orders_tenant_payment_idx").on(table.tenantId, table.paymentStatus),
    index("orders_tenant_delivery_idx").on(table.tenantId, table.deliveryStatus),
    index("orders_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    productId: uuid("product_id").references(() => products.id),
    title: varchar("title", { length: 220 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitAmountMinor: integer("unit_amount_minor"),
    totalAmountMinor: integer("total_amount_minor"),
    currency: varchar("currency", { length: 3 }).notNull().default("SYP"),
    createdAt: createdAt(),
  },
  (table) => [
    index("order_items_tenant_order_idx").on(table.tenantId, table.orderId),
    index("order_items_tenant_product_idx").on(table.tenantId, table.productId),
  ],
);

export const commissions = pgTable(
  "commissions",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    orderId: uuid("order_id").references(() => orders.id),
    productId: uuid("product_id").references(() => products.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    commissionType: commissionTypeEnum("commission_type")
      .notNull()
      .default("unknown"),
    amountMinor: integer("amount_minor"),
    percentage: numeric("percentage", { precision: 5, scale: 2 }),
    currency: varchar("currency", { length: 3 }).notNull().default("SYP"),
    status: commissionStatusEnum("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("commissions_tenant_status_idx").on(table.tenantId, table.status),
    index("commissions_tenant_contact_idx").on(table.tenantId, table.contactId),
    index("commissions_tenant_order_idx").on(table.tenantId, table.orderId),
    index("commissions_tenant_product_idx").on(table.tenantId, table.productId),
  ],
);
