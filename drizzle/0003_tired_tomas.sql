CREATE TABLE "whatsapp_auth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"key_type" varchar(80) NOT NULL,
	"key_id" varchar(500) NOT NULL,
	"encrypted_payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_auth_states" ADD CONSTRAINT "whatsapp_auth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_auth_states" ADD CONSTRAINT "whatsapp_auth_states_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_auth_states_key_unique" ON "whatsapp_auth_states" USING btree ("tenant_id","whatsapp_account_id","key_type","key_id");--> statement-breakpoint
CREATE INDEX "whatsapp_auth_states_account_idx" ON "whatsapp_auth_states" USING btree ("tenant_id","whatsapp_account_id");