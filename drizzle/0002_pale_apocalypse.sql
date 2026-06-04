ALTER TABLE "whatsapp_accounts" ADD COLUMN "qr_code" text;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "qr_expires_at" timestamp with time zone;