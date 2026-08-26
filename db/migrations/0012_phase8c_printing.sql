CREATE TYPE "public"."print_document_type" AS ENUM('KITCHEN_ORDER', 'KITCHEN_CANCEL', 'CUSTOMER_BILL', 'PAYMENT_RECEIPT', 'X_REPORT', 'Z_REPORT', 'TEST_PRINT');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('PENDING', 'PROCESSING', 'PRINTED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."printer_station_type" AS ENUM('KITCHEN', 'BAR', 'RECEIPT', 'GENERAL');--> statement-breakpoint
CREATE TABLE "print_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"print_job_id" uuid NOT NULL,
	"printer_agent_id" uuid,
	"attempt_number" smallint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"succeeded" boolean DEFAULT false NOT NULL,
	"error_code" varchar(60),
	"error_summary" varchar(300),
	"bytes_written" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_job_attempts_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "print_job_attempts_job_attempt_key" UNIQUE("print_job_id","attempt_number"),
	CONSTRAINT "print_job_attempts_number_check" CHECK ("print_job_attempts"."attempt_number" > 0),
	CONSTRAINT "print_job_attempts_bytes_check" CHECK ("print_job_attempts"."bytes_written" is null or "print_job_attempts"."bytes_written" >= 0)
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	"printer_name_snapshot" varchar(80) NOT NULL,
	"document_type" "print_document_type" NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid,
	"payload_version" integer NOT NULL,
	"payload_snapshot" jsonb NOT NULL,
	"copies" smallint DEFAULT 1 NOT NULL,
	"status" "print_job_status" DEFAULT 'PENDING' NOT NULL,
	"dedupe_key" varchar(160),
	"requested_by_staff_id" uuid,
	"reprint_of_job_id" uuid,
	"reprint_reason" varchar(300),
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_agent_id" uuid,
	"lease_until" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error_code" varchar(60),
	"last_error_summary" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_jobs_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "print_jobs_copies_check" CHECK ("print_jobs"."copies" between 1 and 5),
	CONSTRAINT "print_jobs_attempts_check" CHECK ("print_jobs"."attempt_count" between 0 and 50),
	CONSTRAINT "print_jobs_payload_version_check" CHECK ("print_jobs"."payload_version" > 0),
	CONSTRAINT "print_jobs_reprint_reason_check" CHECK (("print_jobs"."reprint_of_job_id" is null and "print_jobs"."reprint_reason" is null)
        or ("print_jobs"."reprint_of_job_id" is not null and length(btrim("print_jobs"."reprint_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "printer_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"token_hash" varchar(80) NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"software_version" varchar(40),
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printer_agents_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "printer_agents_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "printer_agents_token_version_check" CHECK ("printer_agents"."token_version" > 0),
	CONSTRAINT "printer_agents_token_hash_format_check" CHECK ("printer_agents"."token_hash" ~ '^v[0-9]+[.][A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
CREATE TABLE "printer_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"document_type" "print_document_type" NOT NULL,
	"category_id" uuid,
	"printer_id" uuid NOT NULL,
	"copies" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printer_routes_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "printer_routes_copies_check" CHECK ("printer_routes"."copies" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "restaurant_printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"printer_agent_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"code" varchar(40) NOT NULL,
	"station_type" "printer_station_type" DEFAULT 'GENERAL' NOT NULL,
	"device_key" varchar(80) NOT NULL,
	"characters_per_line" smallint DEFAULT 48 NOT NULL,
	"encoding" varchar(20) DEFAULT 'CP857' NOT NULL,
	"auto_cut" boolean DEFAULT true NOT NULL,
	"default_copies" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_printers_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "restaurant_printers_restaurant_code_key" UNIQUE("restaurant_id","code"),
	CONSTRAINT "restaurant_printers_code_format_check" CHECK ("restaurant_printers"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
	CONSTRAINT "restaurant_printers_device_key_format_check" CHECK ("restaurant_printers"."device_key" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
	CONSTRAINT "restaurant_printers_characters_check" CHECK ("restaurant_printers"."characters_per_line" between 24 and 96),
	CONSTRAINT "restaurant_printers_copies_check" CHECK ("restaurant_printers"."default_copies" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "print_job_attempts" ADD CONSTRAINT "print_job_attempts_restaurant_job_fk" FOREIGN KEY ("restaurant_id","print_job_id") REFERENCES "public"."print_jobs"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job_attempts" ADD CONSTRAINT "print_job_attempts_restaurant_agent_fk" FOREIGN KEY ("restaurant_id","printer_agent_id") REFERENCES "public"."printer_agents"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_restaurant_printer_fk" FOREIGN KEY ("restaurant_id","printer_id") REFERENCES "public"."restaurant_printers"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_restaurant_requester_fk" FOREIGN KEY ("restaurant_id","requested_by_staff_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_restaurant_agent_fk" FOREIGN KEY ("restaurant_id","claimed_by_agent_id") REFERENCES "public"."printer_agents"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_reprint_origin_fk" FOREIGN KEY ("restaurant_id","reprint_of_job_id") REFERENCES "public"."print_jobs"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_agents" ADD CONSTRAINT "printer_agents_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_routes" ADD CONSTRAINT "printer_routes_restaurant_printer_fk" FOREIGN KEY ("restaurant_id","printer_id") REFERENCES "public"."restaurant_printers"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_routes" ADD CONSTRAINT "printer_routes_restaurant_category_fk" FOREIGN KEY ("restaurant_id","category_id") REFERENCES "public"."categories"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_printers" ADD CONSTRAINT "restaurant_printers_restaurant_agent_fk" FOREIGN KEY ("restaurant_id","printer_agent_id") REFERENCES "public"."printer_agents"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "print_job_attempts_job_created_idx" ON "print_job_attempts" USING btree ("print_job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_restaurant_dedupe_key" ON "print_jobs" USING btree ("restaurant_id","dedupe_key") WHERE "print_jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "print_jobs_claim_idx" ON "print_jobs" USING btree ("restaurant_id","printer_id","available_at") WHERE "print_jobs"."status" in ('PENDING', 'PROCESSING');--> statement-breakpoint
CREATE INDEX "print_jobs_restaurant_status_created_idx" ON "print_jobs" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "print_jobs_restaurant_source_idx" ON "print_jobs" USING btree ("restaurant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "print_jobs_reprint_origin_idx" ON "print_jobs" USING btree ("restaurant_id","reprint_of_job_id") WHERE "print_jobs"."reprint_of_job_id" is not null;--> statement-breakpoint
CREATE INDEX "printer_agents_restaurant_active_idx" ON "printer_agents" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "printer_routes_unique_target_key" ON "printer_routes" USING btree ("restaurant_id","document_type","category_id","printer_id") WHERE "printer_routes"."category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "printer_routes_unique_default_key" ON "printer_routes" USING btree ("restaurant_id","document_type","printer_id") WHERE "printer_routes"."category_id" is null;--> statement-breakpoint
CREATE INDEX "printer_routes_lookup_idx" ON "printer_routes" USING btree ("restaurant_id","document_type","is_active");--> statement-breakpoint
CREATE INDEX "restaurant_printers_restaurant_active_idx" ON "restaurant_printers" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE INDEX "restaurant_printers_agent_idx" ON "restaurant_printers" USING btree ("restaurant_id","printer_agent_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Phase 8C security addendum (hand-written; Drizzle does not generate these).
--
-- Fully additive: three enums, five tables, their indexes and foreign keys.
-- Nothing is dropped and no existing row is rewritten. No print history is
-- back-filled for orders or payments that predate this migration — a ticket
-- nobody printed is not a ticket.
--
-- The browser never touches any of this. Print jobs are created by the server
-- inside the transaction that changed the order, agents authenticate with
-- their own bearer token over an outbound connection, and `printer_agents`
-- holds only the HMAC digest of that token — never the token itself.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE
  "printer_agents",
  "restaurant_printers",
  "printer_routes",
  "print_jobs",
  "print_job_attempts"
FROM anon, authenticated;--> statement-breakpoint

-- No SELECT is granted either: a signed-in cashier must not be able to read a
-- token digest, a device key or another restaurant's queue from the Data API.
ALTER TABLE "printer_agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restaurant_printers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "printer_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "print_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "print_job_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TRIGGER "printer_agents_set_updated_at"
BEFORE UPDATE ON "printer_agents"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "restaurant_printers_set_updated_at"
BEFORE UPDATE ON "restaurant_printers"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "printer_routes_set_updated_at"
BEFORE UPDATE ON "printer_routes"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "print_jobs_set_updated_at"
BEFORE UPDATE ON "print_jobs"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
