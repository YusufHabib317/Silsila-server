CREATE TYPE "public"."commission_status" AS ENUM('pending', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."commission_type" AS ENUM('fixed_amount', 'percentage', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('merchant', 'agent', 'customer', 'supplier', 'factory', 'internal', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('not_started', 'preparing', 'with_delivery', 'delivered', 'returned', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."message_bundle_status" AS ENUM('draft', 'reviewed', 'linked', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."message_bundle_type" AS ENUM('product', 'order', 'product_update', 'order_update', 'customer_request', 'merchant_note', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'needs_review', 'confirmed', 'preparing', 'shipped', 'delivered', 'paid', 'cancelled', 'returned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partial', 'paid', 'refunded', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."product_owner_type" AS ENUM('own_stock', 'merchant_product', 'factory_product', 'agent_product', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'out_of_stock', 'price_changed', 'paused', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."stock_status" AS ENUM('in_stock', 'low_stock', 'out_of_stock', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('free', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."tenant_role" AS ENUM('owner', 'manager', 'agent', 'viewer', 'accountant');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'trial', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."tracked_source_status" AS ENUM('tracked', 'ignored', 'personal');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_account_status" AS ENUM('pending_qr', 'qr_ready', 'connecting', 'connected', 'disconnected', 'reconnecting', 'expired', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_message_type" AS ENUM('text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contact', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_source_type" AS ENUM('merchant_group', 'agent_group', 'customer_chat', 'supplier_chat', 'internal_team', 'unknown');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid,
	"product_id" uuid,
	"contact_id" uuid NOT NULL,
	"commission_type" "commission_type" DEFAULT 'unknown' NOT NULL,
	"amount_minor" integer,
	"percentage" numeric(5, 2),
	"currency" varchar(3) DEFAULT 'SYP' NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" "contact_role" NOT NULL,
	"context_type" varchar(60),
	"context_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_whatsapp_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"whatsapp_contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" varchar(180) NOT NULL,
	"phone_number" varchar(40),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_message_id" uuid,
	"owner_type" varchar(60) NOT NULL,
	"owner_id" uuid,
	"bucket" varchar(180) NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" varchar(180) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_class" varchar(40) NOT NULL,
	"is_temporary" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_bundle_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"whatsapp_message_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"source_chat_id" uuid NOT NULL,
	"title" varchar(220) NOT NULL,
	"status" "message_bundle_status" DEFAULT 'draft' NOT NULL,
	"bundle_type" "message_bundle_type" DEFAULT 'unknown' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"title" varchar(220) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_minor" integer,
	"total_amount_minor" integer,
	"currency" varchar(3) DEFAULT 'SYP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_number" varchar(80) NOT NULL,
	"customer_contact_id" uuid,
	"merchant_contact_id" uuid,
	"agent_contact_id" uuid,
	"source_bundle_id" uuid,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unknown' NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'unknown' NOT NULL,
	"total_amount_minor" integer,
	"currency" varchar(3) DEFAULT 'SYP' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(220) NOT NULL,
	"description" text,
	"category_id" uuid,
	"owner_type" "product_owner_type" DEFAULT 'unknown' NOT NULL,
	"owner_contact_id" uuid,
	"merchant_contact_id" uuid,
	"source_bundle_id" uuid,
	"cost_amount_minor" integer,
	"sale_amount_minor" integer,
	"agent_amount_minor" integer,
	"currency" varchar(3) DEFAULT 'SYP' NOT NULL,
	"stock_status" "stock_status" DEFAULT 'unknown' NOT NULL,
	"product_status" "product_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "tenant_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(180) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"plan" "tenant_plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracked_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"status" "tracked_source_status" DEFAULT 'tracked' NOT NULL,
	"source_type" "whatsapp_source_type" DEFAULT 'unknown' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_number" varchar(40),
	"display_name" varchar(160),
	"status" "whatsapp_account_status" DEFAULT 'pending_qr' NOT NULL,
	"last_connected_at" timestamp with time zone,
	"last_disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"external_chat_id" varchar(240) NOT NULL,
	"display_name" varchar(240),
	"source_type" "whatsapp_source_type" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"external_contact_id" varchar(240) NOT NULL,
	"phone_number" varchar(40),
	"display_name" varchar(180),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender_contact_id" uuid,
	"external_message_id" varchar(240) NOT NULL,
	"message_type" "whatsapp_message_type" DEFAULT 'unknown' NOT NULL,
	"body_text" text,
	"raw_payload_json" jsonb NOT NULL,
	"is_from_me" boolean DEFAULT false NOT NULL,
	"is_tracked" boolean DEFAULT false NOT NULL,
	"is_linked" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_personal" boolean DEFAULT false NOT NULL,
	"is_temporary" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_roles" ADD CONSTRAINT "contact_roles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_whatsapp_identities" ADD CONSTRAINT "contact_whatsapp_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_whatsapp_identities" ADD CONSTRAINT "contact_whatsapp_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_whatsapp_identities" ADD CONSTRAINT "contact_whatsapp_identities_whatsapp_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_whatsapp_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("whatsapp_message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundle_items" ADD CONSTRAINT "message_bundle_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundle_items" ADD CONSTRAINT "message_bundle_items_bundle_id_message_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."message_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundle_items" ADD CONSTRAINT "message_bundle_items_whatsapp_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("whatsapp_message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundles" ADD CONSTRAINT "message_bundles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundles" ADD CONSTRAINT "message_bundles_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundles" ADD CONSTRAINT "message_bundles_source_chat_id_whatsapp_chats_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."whatsapp_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_bundles" ADD CONSTRAINT "message_bundles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_contact_id_contacts_id_fk" FOREIGN KEY ("customer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_contact_id_contacts_id_fk" FOREIGN KEY ("merchant_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_contact_id_contacts_id_fk" FOREIGN KEY ("agent_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_bundle_id_message_bundles_id_fk" FOREIGN KEY ("source_bundle_id") REFERENCES "public"."message_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_contact_id_contacts_id_fk" FOREIGN KEY ("merchant_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_bundle_id_message_bundles_id_fk" FOREIGN KEY ("source_bundle_id") REFERENCES "public"."message_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sources" ADD CONSTRAINT "tracked_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sources" ADD CONSTRAINT "tracked_sources_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sources" ADD CONSTRAINT "tracked_sources_chat_id_whatsapp_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."whatsapp_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sources" ADD CONSTRAINT "tracked_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_chat_id_whatsapp_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."whatsapp_chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sender_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("sender_contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "commissions_tenant_status_idx" ON "commissions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "commissions_tenant_contact_idx" ON "commissions" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "commissions_tenant_order_idx" ON "commissions" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "contact_roles_tenant_contact_idx" ON "contact_roles" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_roles_tenant_role_idx" ON "contact_roles" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_whatsapp_identities_unique" ON "contact_whatsapp_identities" USING btree ("tenant_id","whatsapp_contact_id");--> statement-breakpoint
CREATE INDEX "contact_whatsapp_identities_contact_idx" ON "contact_whatsapp_identities" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "contacts_tenant_created_idx" ON "contacts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "contacts_tenant_phone_idx" ON "contacts" USING btree ("tenant_id","phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_object_key_unique" ON "media_objects" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "media_objects_tenant_expires_idx" ON "media_objects" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "media_objects_tenant_owner_idx" ON "media_objects" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_bundle_items_message_unique" ON "message_bundle_items" USING btree ("tenant_id","bundle_id","whatsapp_message_id");--> statement-breakpoint
CREATE INDEX "message_bundle_items_bundle_idx" ON "message_bundle_items" USING btree ("tenant_id","bundle_id");--> statement-breakpoint
CREATE INDEX "message_bundles_tenant_status_idx" ON "message_bundles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "message_bundles_tenant_created_idx" ON "message_bundles" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_tenant_order_idx" ON "order_items" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "order_items_tenant_product_idx" ON "order_items" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_order_number_unique" ON "orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_idx" ON "orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "orders_tenant_payment_idx" ON "orders" USING btree ("tenant_id","payment_status");--> statement-breakpoint
CREATE INDEX "orders_tenant_delivery_idx" ON "orders" USING btree ("tenant_id","delivery_status");--> statement-breakpoint
CREATE INDEX "orders_tenant_created_idx" ON "orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_user_unique" ON "platform_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "products_tenant_status_idx" ON "products" USING btree ("tenant_id","product_status");--> statement-breakpoint
CREATE INDEX "products_tenant_created_idx" ON "products" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "products_tenant_merchant_idx" ON "products" USING btree ("tenant_id","merchant_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_users_tenant_user_unique" ON "tenant_users" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_users_tenant_idx" ON "tenant_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_users_user_idx" ON "tenant_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tenant_users_tenant_status_idx" ON "tenant_users" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_sources_chat_unique" ON "tracked_sources" USING btree ("tenant_id","chat_id");--> statement-breakpoint
CREATE INDEX "tracked_sources_tenant_status_idx" ON "tracked_sources" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "whatsapp_accounts_tenant_idx" ON "whatsapp_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "whatsapp_accounts_tenant_status_idx" ON "whatsapp_accounts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_chats_external_unique" ON "whatsapp_chats" USING btree ("tenant_id","whatsapp_account_id","external_chat_id");--> statement-breakpoint
CREATE INDEX "whatsapp_chats_tenant_account_idx" ON "whatsapp_chats" USING btree ("tenant_id","whatsapp_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contacts_external_unique" ON "whatsapp_contacts" USING btree ("tenant_id","whatsapp_account_id","external_contact_id");--> statement-breakpoint
CREATE INDEX "whatsapp_contacts_tenant_account_idx" ON "whatsapp_contacts" USING btree ("tenant_id","whatsapp_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_external_unique" ON "whatsapp_messages" USING btree ("tenant_id","whatsapp_account_id","external_message_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_tenant_created_idx" ON "whatsapp_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_tenant_expires_idx" ON "whatsapp_messages" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_tenant_chat_idx" ON "whatsapp_messages" USING btree ("tenant_id","chat_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_tenant_flags_idx" ON "whatsapp_messages" USING btree ("tenant_id","is_tracked","is_linked","is_archived");