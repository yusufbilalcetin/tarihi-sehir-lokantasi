CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."kitchen_ticket_status" AS ENUM('NEW', 'PREPARING', 'READY', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_creator_type" AS ENUM('CUSTOMER', 'STAFF', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."order_event_type" AS ENUM('ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_PREPARING', 'ORDER_READY', 'ORDER_SERVED', 'ORDER_COMPLETED', 'ORDER_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_item_status" AS ENUM('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('NEW', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."table_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'ORDERING', 'WAITING', 'DINING', 'WAITER_CALL', 'BILL_REQUESTED', 'CLEANING', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'MANAGER', 'WAITER', 'KITCHEN', 'CASHIER');--> statement-breakpoint
CREATE TYPE "public"."waiter_call_status" AS ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."waiter_call_type" AS ENUM('WAITER_CALL', 'BILL_REQUEST', 'OTHER');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" varchar(100),
	"ip_address" "inet",
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "categories_restaurant_id_slug_key" UNIQUE("restaurant_id","slug"),
	CONSTRAINT "categories_sort_order_check" CHECK ("categories"."sort_order" >= 0),
	CONSTRAINT "categories_slug_format_check" CHECK ("categories"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"scope" varchar(100) NOT NULL,
	"key_hash" char(64) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"status" "idempotency_status" DEFAULT 'PROCESSING' NOT NULL,
	"resource_type" varchar(80),
	"resource_id" uuid,
	"response_status" smallint,
	"response_body" jsonb,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_restaurant_scope_hash_key" UNIQUE("restaurant_id","scope","key_hash"),
	CONSTRAINT "idempotency_keys_key_hash_format_check" CHECK ("idempotency_keys"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_keys_request_hash_format_check" CHECK ("idempotency_keys"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_keys_response_status_check" CHECK ("idempotency_keys"."response_status" is null or "idempotency_keys"."response_status" between 100 and 599),
	CONSTRAINT "idempotency_keys_expiry_check" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at")
);
--> statement-breakpoint
CREATE TABLE "kitchen_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "kitchen_ticket_status" DEFAULT 'NEW' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"notes" varchar(500),
	"preparation_started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_tickets_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "kitchen_tickets_restaurant_order_key" UNIQUE("restaurant_id","order_id"),
	CONSTRAINT "kitchen_tickets_priority_check" CHECK ("kitchen_tickets"."priority" between -10 and 10)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"event_type" "order_event_type" NOT NULL,
	"user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" varchar(180) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"notes" varchar(500),
	"status" "order_item_status" DEFAULT 'PENDING' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "order_items_unit_price_check" CHECK ("order_items"."unit_price" >= 0),
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" between 1 and 99),
	CONSTRAINT "order_items_line_total_check" CHECK ("order_items"."line_total" >= 0),
	CONSTRAINT "order_items_line_total_formula_check" CHECK ("order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity"),
	CONSTRAINT "order_items_sort_order_check" CHECK ("order_items"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"order_sequence" bigint NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"status" "order_status" DEFAULT 'NEW' NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"service_charge_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"notes" varchar(1000),
	"created_by_type" "order_creator_type" NOT NULL,
	"created_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "orders_restaurant_sequence_key" UNIQUE("restaurant_id","order_sequence"),
	CONSTRAINT "orders_restaurant_number_key" UNIQUE("restaurant_id","order_number"),
	CONSTRAINT "orders_sequence_check" CHECK ("orders"."order_sequence" > 0),
	CONSTRAINT "orders_subtotal_check" CHECK ("orders"."subtotal" >= 0),
	CONSTRAINT "orders_discount_total_check" CHECK ("orders"."discount_total" >= 0),
	CONSTRAINT "orders_service_charge_total_check" CHECK ("orders"."service_charge_total" >= 0),
	CONSTRAINT "orders_tax_total_check" CHECK ("orders"."tax_total" >= 0),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total" >= 0),
	CONSTRAINT "orders_total_formula_check" CHECK ("orders"."total" = "orders"."subtotal" - "orders"."discount_total" + "orders"."service_charge_total" + "orders"."tax_total"),
	CONSTRAINT "orders_version_check" CHECK ("orders"."version" > 0),
	CONSTRAINT "orders_creator_check" CHECK ("orders"."created_by_type" <> 'STAFF' or "orders"."created_by_user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(120),
	"published_at" timestamp with time zone,
	"last_error" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" between 0 and 50)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"refunded_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"external_reference" varchar(255),
	"created_by_user_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_refunded_amount_check" CHECK ("payments"."refunded_amount" >= 0 and "payments"."refunded_amount" <= "payments"."amount")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"description" text,
	"price" numeric(12, 2) NOT NULL,
	"image_url" text,
	"weight_label" varchar(60),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_spicy" boolean DEFAULT false NOT NULL,
	"is_vegetarian" boolean DEFAULT false NOT NULL,
	"allergens" text[] DEFAULT array[]::text[] NOT NULL,
	"tags" text[] DEFAULT array[]::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "products_restaurant_id_slug_key" UNIQUE("restaurant_id","slug"),
	CONSTRAINT "products_price_check" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_sort_order_check" CHECK ("products"."sort_order" >= 0),
	CONSTRAINT "products_version_check" CHECK ("products"."version" > 0),
	CONSTRAINT "products_slug_format_check" CHECK ("products"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "restaurant_counters" (
	"restaurant_id" uuid NOT NULL,
	"counter_name" varchar(64) NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_counters_pkey" PRIMARY KEY("restaurant_id","counter_name"),
	CONSTRAINT "restaurant_counters_current_value_check" CHECK ("restaurant_counters"."current_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "restaurant_settings" (
	"restaurant_id" uuid PRIMARY KEY NOT NULL,
	"menu_enabled" boolean DEFAULT true NOT NULL,
	"ordering_enabled" boolean DEFAULT true NOT NULL,
	"waiter_call_enabled" boolean DEFAULT true NOT NULL,
	"bill_request_enabled" boolean DEFAULT true NOT NULL,
	"intro_enabled" boolean DEFAULT true NOT NULL,
	"waiter_approval_required" boolean DEFAULT true NOT NULL,
	"customer_notes_enabled" boolean DEFAULT true NOT NULL,
	"menu_images_enabled" boolean DEFAULT true NOT NULL,
	"service_fee_rate" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"max_item_quantity" smallint DEFAULT 20 NOT NULL,
	"order_notes_max_length" smallint DEFAULT 500 NOT NULL,
	"waiter_call_cooldown_seconds" smallint DEFAULT 30 NOT NULL,
	"notifications" jsonb DEFAULT '{"sound":true,"waiterCall":true,"newOrder":true,"billRequest":true}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_settings_service_fee_rate_check" CHECK ("restaurant_settings"."service_fee_rate" between 0 and 100),
	CONSTRAINT "restaurant_settings_tax_rate_check" CHECK ("restaurant_settings"."tax_rate" between 0 and 100),
	CONSTRAINT "restaurant_settings_max_item_quantity_check" CHECK ("restaurant_settings"."max_item_quantity" between 1 and 99),
	CONSTRAINT "restaurant_settings_notes_length_check" CHECK ("restaurant_settings"."order_notes_max_length" between 0 and 1000),
	CONSTRAINT "restaurant_settings_call_cooldown_check" CHECK ("restaurant_settings"."waiter_call_cooldown_seconds" between 5 and 3600),
	CONSTRAINT "restaurant_settings_version_check" CHECK ("restaurant_settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "restaurant_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"table_number" integer NOT NULL,
	"seats" smallint DEFAULT 4 NOT NULL,
	"qr_token_hash" varchar(80) NOT NULL,
	"qr_token_version" integer DEFAULT 1 NOT NULL,
	"qr_token_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qr_token_revoked_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_status" "table_status" DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_tables_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "restaurant_tables_restaurant_number_key" UNIQUE("restaurant_id","table_number"),
	CONSTRAINT "restaurant_tables_qr_token_hash_key" UNIQUE("qr_token_hash"),
	CONSTRAINT "restaurant_tables_number_check" CHECK ("restaurant_tables"."table_number" > 0),
	CONSTRAINT "restaurant_tables_seats_check" CHECK ("restaurant_tables"."seats" between 1 and 100),
	CONSTRAINT "restaurant_tables_qr_hash_format_check" CHECK ("restaurant_tables"."qr_token_hash" ~ '^v[0-9]+[.][A-Za-z0-9_-]{43}$'),
	CONSTRAINT "restaurant_tables_qr_version_check" CHECK ("restaurant_tables"."qr_token_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"logo_url" text,
	"phone" varchar(40),
	"address" text,
	"currency" char(3) DEFAULT 'TRY' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Istanbul' NOT NULL,
	"default_locale" varchar(16) DEFAULT 'tr-TR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurants_slug_key" UNIQUE("slug"),
	CONSTRAINT "restaurants_slug_format_check" CHECK ("restaurants"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "restaurants_currency_format_check" CHECK ("restaurants"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254),
	"phone" varchar(40),
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_restaurant_id_id_key" UNIQUE("restaurant_id","id")
);
--> statement-breakpoint
CREATE TABLE "waiter_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"type" "waiter_call_type" NOT NULL,
	"request_label" varchar(120),
	"notes" varchar(500),
	"status" "waiter_call_status" DEFAULT 'OPEN' NOT NULL,
	"table_token_version" integer NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiter_calls_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "waiter_calls_token_version_check" CHECK ("waiter_calls"."table_token_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurant_actor_fk" FOREIGN KEY ("restaurant_id","actor_user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_restaurant_user_fk" FOREIGN KEY ("restaurant_id","user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurant_product_fk" FOREIGN KEY ("restaurant_id","product_id") REFERENCES "public"."products"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_table_fk" FOREIGN KEY ("restaurant_id","table_id") REFERENCES "public"."restaurant_tables"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_creator_fk" FOREIGN KEY ("restaurant_id","created_by_user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_creator_fk" FOREIGN KEY ("restaurant_id","created_by_user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_restaurant_category_fk" FOREIGN KEY ("restaurant_id","category_id") REFERENCES "public"."categories"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_counters" ADD CONSTRAINT "restaurant_counters_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_restaurant_table_fk" FOREIGN KEY ("restaurant_id","table_id") REFERENCES "public"."restaurant_tables"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_restaurant_acknowledger_fk" FOREIGN KEY ("restaurant_id","acknowledged_by") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiter_calls" ADD CONSTRAINT "waiter_calls_restaurant_resolver_fk" FOREIGN KEY ("restaurant_id","resolved_by") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_restaurant_created_idx" ON "audit_logs" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_restaurant_entity_created_idx" ON "audit_logs" USING btree ("restaurant_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_restaurant_actor_created_idx" ON "audit_logs" USING btree ("restaurant_id","actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "categories_restaurant_active_sort_idx" ON "categories" USING btree ("restaurant_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_restaurant_resource_idx" ON "idempotency_keys" USING btree ("restaurant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "kitchen_tickets_restaurant_status_created_idx" ON "kitchen_tickets" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "order_events_restaurant_order_created_idx" ON "order_events" USING btree ("restaurant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_restaurant_type_created_idx" ON "order_events" USING btree ("restaurant_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "order_items_restaurant_order_status_idx" ON "order_items" USING btree ("restaurant_id","order_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "order_items_restaurant_product_idx" ON "order_items" USING btree ("restaurant_id","product_id");--> statement-breakpoint
CREATE INDEX "orders_restaurant_status_created_idx" ON "orders" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "orders_restaurant_table_status_idx" ON "orders" USING btree ("restaurant_id","table_id","status");--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" USING btree ("status","available_at","created_at") WHERE "outbox_events"."status" in ('PENDING', 'FAILED');--> statement-breakpoint
CREATE INDEX "outbox_events_restaurant_created_idx" ON "outbox_events" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("restaurant_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_restaurant_external_reference_key" ON "payments" USING btree ("restaurant_id","external_reference") WHERE "payments"."external_reference" is not null;--> statement-breakpoint
CREATE INDEX "payments_restaurant_order_status_idx" ON "payments" USING btree ("restaurant_id","order_id","status");--> statement-breakpoint
CREATE INDEX "payments_restaurant_created_idx" ON "payments" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "products_restaurant_category_menu_idx" ON "products" USING btree ("restaurant_id","category_id","is_active","is_available","sort_order");--> statement-breakpoint
CREATE INDEX "products_restaurant_featured_idx" ON "products" USING btree ("restaurant_id","is_featured","is_active");--> statement-breakpoint
CREATE INDEX "products_allergens_gin_idx" ON "products" USING gin ("allergens");--> statement-breakpoint
CREATE INDEX "products_tags_gin_idx" ON "products" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "restaurant_tables_restaurant_status_idx" ON "restaurant_tables" USING btree ("restaurant_id","current_status","is_active");--> statement-breakpoint
CREATE INDEX "restaurant_tables_qr_lookup_idx" ON "restaurant_tables" USING btree ("qr_token_hash","qr_token_version") WHERE "restaurant_tables"."is_active" and "restaurant_tables"."qr_token_revoked_at" is null;--> statement-breakpoint
CREATE INDEX "restaurants_is_active_idx" ON "restaurants" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_auth_user_id_key" ON "staff_profiles" USING btree ("auth_user_id") WHERE "staff_profiles"."auth_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_restaurant_id_email_key" ON "staff_profiles" USING btree ("restaurant_id",lower("email")) WHERE "staff_profiles"."email" is not null;--> statement-breakpoint
CREATE INDEX "staff_profiles_restaurant_id_role_active_idx" ON "staff_profiles" USING btree ("restaurant_id","role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "waiter_calls_one_active_type_per_table_key" ON "waiter_calls" USING btree ("restaurant_id","table_id","type") WHERE "waiter_calls"."status" in ('OPEN', 'ACKNOWLEDGED');--> statement-breakpoint
CREATE INDEX "waiter_calls_restaurant_status_created_idx" ON "waiter_calls" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "waiter_calls_restaurant_table_created_idx" ON "waiter_calls" USING btree ("restaurant_id","table_id","created_at");--> statement-breakpoint

-- Supabase Auth owns identities. Public staff rows may be created before an
-- invitation is accepted, so the reference is nullable and nulls on auth-user
-- deletion while the operational/audit history remains intact.
ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_auth_user_id_auth_users_id_fk"
  FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id")
  ON DELETE SET NULL;--> statement-breakpoint

-- One database-owned timestamp policy avoids relying on every service path to
-- remember updated_at. PostgreSQL executes this for direct SQL and ORM writes.
CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = transaction_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."set_updated_at"()
FROM PUBLIC, anon, authenticated;--> statement-breakpoint

CREATE TRIGGER "restaurants_set_updated_at"
BEFORE UPDATE ON "restaurants"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "staff_profiles_set_updated_at"
BEFORE UPDATE ON "staff_profiles"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "categories_set_updated_at"
BEFORE UPDATE ON "categories"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "products_set_updated_at"
BEFORE UPDATE ON "products"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "restaurant_tables_set_updated_at"
BEFORE UPDATE ON "restaurant_tables"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "restaurant_counters_set_updated_at"
BEFORE UPDATE ON "restaurant_counters"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "orders_set_updated_at"
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "order_items_set_updated_at"
BEFORE UPDATE ON "order_items"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "kitchen_tickets_set_updated_at"
BEFORE UPDATE ON "kitchen_tickets"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "waiter_calls_set_updated_at"
BEFORE UPDATE ON "waiter_calls"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "payments_set_updated_at"
BEFORE UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "restaurant_settings_set_updated_at"
BEFORE UPDATE ON "restaurant_settings"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "outbox_events_set_updated_at"
BEFORE UPDATE ON "outbox_events"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "idempotency_keys_set_updated_at"
BEFORE UPDATE ON "idempotency_keys"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint

-- Called inside the same transaction that inserts an order. INSERT .. ON
-- CONFLICT obtains the row lock and returns a unique restaurant-scoped value
-- even when multiple application instances create orders concurrently.
CREATE OR REPLACE FUNCTION "public"."next_restaurant_counter"(
  p_restaurant_id uuid,
  p_counter_name text
)
RETURNS bigint
LANGUAGE sql
VOLATILE
STRICT
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.restaurant_counters (
    restaurant_id,
    counter_name,
    current_value
  )
  VALUES (p_restaurant_id, p_counter_name, 1)
  ON CONFLICT (restaurant_id, counter_name)
  DO UPDATE SET current_value = public.restaurant_counters.current_value + 1
  RETURNING current_value;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."next_restaurant_counter"(uuid, text)
FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Public-schema defaults vary between Supabase projects. Start from explicit
-- least privilege: browsers cannot mutate domain data, and anonymous clients
-- receive no direct table access. Public QR flows go through the backend.
REVOKE ALL ON TABLE
  "restaurants",
  "staff_profiles",
  "categories",
  "products",
  "restaurant_tables",
  "restaurant_counters",
  "orders",
  "order_items",
  "kitchen_tickets",
  "waiter_calls",
  "order_events",
  "payments",
  "restaurant_settings",
  "audit_logs",
  "outbox_events",
  "idempotency_keys"
FROM anon, authenticated;--> statement-breakpoint

GRANT SELECT ON TABLE
  "restaurants",
  "staff_profiles",
  "categories",
  "products",
  "orders",
  "order_items",
  "kitchen_tickets",
  "waiter_calls",
  "order_events",
  "restaurant_settings"
TO authenticated;--> statement-breakpoint

ALTER TABLE "restaurants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restaurant_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restaurant_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waiter_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restaurant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- A signed-in user can read only their own active membership row. Admin staff
-- management remains a backend-authorized operation and never depends on a
-- broad browser policy that exposes colleague contact details.
CREATE POLICY "staff_profiles_select_own"
ON "staff_profiles"
FOR SELECT
TO authenticated
USING (
  "auth_user_id" = (SELECT auth.uid())
  AND "is_active"
  AND "deleted_at" IS NULL
);--> statement-breakpoint

CREATE POLICY "restaurants_select_member"
ON "restaurants"
FOR SELECT
TO authenticated
USING (
  restaurants.is_active
  AND
  EXISTS (
    SELECT 1
    FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = restaurants.id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active
      AND membership.deleted_at IS NULL
  )
);--> statement-breakpoint

CREATE POLICY "categories_select_member"
ON "categories"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = categories.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "products_select_member"
ON "products"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = products.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "restaurant_tables_select_member"
ON "restaurant_tables"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = restaurant_tables.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "orders_select_member"
ON "orders"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = orders.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "order_items_select_member"
ON "order_items"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = order_items.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "kitchen_tickets_select_member"
ON "kitchen_tickets"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = kitchen_tickets.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "waiter_calls_select_member"
ON "waiter_calls"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = waiter_calls.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "order_events_select_member"
ON "order_events"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = order_events.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "payments_select_member"
ON "payments"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = payments.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint
CREATE POLICY "restaurant_settings_select_member"
ON "restaurant_settings"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_profiles AS membership
    WHERE membership.restaurant_id = restaurant_settings.restaurant_id
      AND membership.auth_user_id = (SELECT auth.uid())
      AND membership.is_active AND membership.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.restaurants AS active_restaurant WHERE active_restaurant.id = membership.restaurant_id AND active_restaurant.is_active)
  )
);--> statement-breakpoint

-- Supabase creates this publication. Keeping publication changes conditional
-- lets schema generation and SQL review run without connecting to a database.
DO $$
DECLARE
  realtime_table text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH realtime_table IN ARRAY ARRAY[
      'categories',
      'products',
      'orders',
      'order_items',
      'kitchen_tickets',
      'waiter_calls',
      'order_events',
      'outbox_events',
      'restaurant_settings'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = realtime_table
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          realtime_table
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;
