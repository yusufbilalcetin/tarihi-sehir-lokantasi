CREATE TYPE "public"."attendance_status" AS ENUM('OPEN', 'COMPLETED', 'CORRECTED');--> statement-breakpoint
CREATE TYPE "public"."external_transaction_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('NEW', 'REVIEWED', 'HIDDEN');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('DRAFT', 'PLACED', 'WAITING_FOR_COURIER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('PAYMENT_TERMINAL', 'FISCAL_DOCUMENT', 'FISCAL_DEVICE', 'ACCOUNTING', 'DELIVERY_PROVIDER');--> statement-breakpoint
CREATE TYPE "public"."inventory_unit" AS ENUM('MG', 'G', 'KG', 'ML', 'L', 'UNIT', 'PACKAGE', 'CASE');--> statement-breakpoint
CREATE TYPE "public"."loyalty_entry_type" AS ENUM('EARN', 'REDEEM', 'ADJUST', 'EXPIRE');--> statement-breakpoint
CREATE TYPE "public"."negative_stock_policy" AS ENUM('WARN', 'BLOCK');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."production_status" AS ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_count_status" AS ENUM('DRAFT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('PURCHASE_RECEIPT', 'PRODUCTION_CONSUMPTION', 'MANUAL_ADJUSTMENT', 'WASTE', 'STAFF_MEAL', 'COMPLIMENTARY', 'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT_CORRECTION', 'RETURN_TO_SUPPLIER');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_method" AS ENUM('BANK', 'CASH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."waste_type" AS ENUM('SPOILAGE', 'SPILL', 'PREPARATION_WASTE', 'STAFF_MEAL', 'COMPLIMENTARY', 'OTHER');--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_status" DEFAULT 'OPEN' NOT NULL,
	"correction_reason" varchar(300),
	"corrected_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_time_check" CHECK ("attendance_records"."clock_out_at" is null or "attendance_records"."clock_out_at" > "attendance_records"."clock_in_at"),
	CONSTRAINT "attendance_records_break_check" CHECK ("attendance_records"."break_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"name" varchar(160) NOT NULL,
	"email" varchar(254),
	"phone" varchar(40),
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"marketing_consent_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "customer_accounts_consent_check" CHECK (not "customer_accounts"."marketing_consent" or "customer_accounts"."marketing_consent_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid,
	"table_id" uuid,
	"session_fingerprint_hash" varchar(80) NOT NULL,
	"rating" smallint NOT NULL,
	"food_rating" smallint,
	"service_rating" smallint,
	"cleanliness_rating" smallint,
	"comment" varchar(1000),
	"status" "feedback_status" DEFAULT 'NEW' NOT NULL,
	"reviewed_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_feedback_rating_check" CHECK ("customer_feedback"."rating" between 1 and 5 and ("customer_feedback"."food_rating" is null or "customer_feedback"."food_rating" between 1 and 5) and ("customer_feedback"."service_rating" is null or "customer_feedback"."service_rating" between 1 and 5) and ("customer_feedback"."cleanliness_rating" is null or "customer_feedback"."cleanliness_rating" between 1 and 5))
);
--> statement-breakpoint
CREATE TABLE "customer_order_links" (
	"restaurant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_order_links_order_key" UNIQUE("restaurant_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "external_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"integration_connection_id" uuid NOT NULL,
	"operation_type" varchar(60) NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid,
	"amount" numeric(14, 2),
	"currency" varchar(3),
	"status" "external_transaction_status" DEFAULT 'PENDING' NOT NULL,
	"provider_reference" varchar(180),
	"idempotency_key" varchar(160) NOT NULL,
	"error_code" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_transactions_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "external_transactions_amount_check" CHECK ("external_transactions"."amount" is null or "external_transactions"."amount" >= 0),
	CONSTRAINT "external_transactions_currency_check" CHECK ("external_transactions"."currency" is null or "external_transactions"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "fulfillment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid,
	"channel" "order_channel" NOT NULL,
	"status" "fulfillment_status" DEFAULT 'DRAFT' NOT NULL,
	"customer_name" varchar(160) NOT NULL,
	"contact" varchar(80) NOT NULL,
	"address" text,
	"delivery_notes" varchar(500),
	"requested_at" timestamp with time zone,
	"delivery_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"courier_staff_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_requests_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "fulfillment_requests_channel_check" CHECK (("fulfillment_requests"."channel" = 'TAKEAWAY' and "fulfillment_requests"."address" is null) or ("fulfillment_requests"."channel" = 'DELIVERY' and length(btrim("fulfillment_requests"."address")) > 0)),
	CONSTRAINT "fulfillment_requests_fee_check" CHECK ("fulfillment_requests"."delivery_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"received_quantity" numeric(18, 6) NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_items_receipt_po_item_key" UNIQUE("goods_receipt_id","purchase_order_item_id"),
	CONSTRAINT "goods_receipt_items_qty_check" CHECK ("goods_receipt_items"."received_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"receipt_number" varchar(60) NOT NULL,
	"received_by_staff_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_restaurant_number_key" UNIQUE("restaurant_id","receipt_number"),
	CONSTRAINT "goods_receipts_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"provider" varchar(80) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"secret_reference" varchar(160),
	"is_enabled" boolean DEFAULT false NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_restaurant_kind_provider_key" UNIQUE("restaurant_id","kind","provider"),
	CONSTRAINT "integration_connections_secret_reference_check" CHECK ("integration_connections"."secret_reference" is null or "integration_connections"."secret_reference" ~ '^[A-Z][A-Z0-9_]{2,159}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(80),
	"base_unit" "inventory_unit" NOT NULL,
	"reorder_level" numeric(18, 6) DEFAULT '0' NOT NULL,
	"negative_stock_policy" "negative_stock_policy" DEFAULT 'WARN' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "inventory_items_reorder_level_check" CHECK ("inventory_items"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"order_id" uuid,
	"entry_type" "loyalty_entry_type" NOT NULL,
	"points" integer NOT NULL,
	"reason" varchar(300) NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_staff_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_ledger_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "loyalty_ledger_points_check" CHECK ("loyalty_ledger"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"gross_salary" numeric(14, 2) NOT NULL,
	"allowances" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deductions" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(14, 2) NOT NULL,
	"status" "payroll_status" DEFAULT 'DRAFT' NOT NULL,
	"correction_reason" varchar(300),
	"approved_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_entries_staff_period_key" UNIQUE("restaurant_id","staff_id","period_start","period_end"),
	CONSTRAINT "payroll_entries_period_check" CHECK ("payroll_entries"."period_end" >= "payroll_entries"."period_start"),
	CONSTRAINT "payroll_entries_minutes_check" CHECK ("payroll_entries"."worked_minutes" >= 0 and "payroll_entries"."overtime_minutes" >= 0),
	CONSTRAINT "payroll_entries_total_check" CHECK ("payroll_entries"."net_payable" = "payroll_entries"."gross_salary" + "payroll_entries"."allowances" - "payroll_entries"."deductions")
);
--> statement-breakpoint
CREATE TABLE "popular_product_snapshots" (
	"restaurant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"window_days" smallint DEFAULT 30 NOT NULL,
	"quantity_sold" integer NOT NULL,
	"rank" smallint NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "popular_product_snapshots_product_key" UNIQUE("restaurant_id","product_id","window_days"),
	CONSTRAINT "popular_product_snapshots_values_check" CHECK ("popular_product_snapshots"."window_days" between 1 and 366 and "popular_product_snapshots"."quantity_sold" >= 0 and "popular_product_snapshots"."rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"planned_portions" numeric(18, 6) NOT NULL,
	"actual_portions" numeric(18, 6) DEFAULT '0' NOT NULL,
	"sold_portions" numeric(18, 6) DEFAULT '0' NOT NULL,
	"waste_portions" numeric(18, 6) DEFAULT '0' NOT NULL,
	"status" "production_status" DEFAULT 'PLANNED' NOT NULL,
	"produced_by_staff_id" uuid,
	"consumption_posted_at" timestamp with time zone,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_batches_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "production_batches_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "production_batches_quantities_check" CHECK ("production_batches"."planned_portions" >= 0 and "production_batches"."actual_portions" >= 0 and "production_batches"."sold_portions" >= 0 and "production_batches"."waste_portions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"ordered_quantity" numeric(18, 6) NOT NULL,
	"received_quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_items_order_item_key" UNIQUE("purchase_order_id","inventory_item_id"),
	CONSTRAINT "purchase_order_items_qty_check" CHECK ("purchase_order_items"."ordered_quantity" > 0 and "purchase_order_items"."received_quantity" >= 0 and "purchase_order_items"."received_quantity" <= "purchase_order_items"."ordered_quantity"),
	CONSTRAINT "purchase_order_items_total_check" CHECK ("purchase_order_items"."line_total" = round("purchase_order_items"."ordered_quantity" * "purchase_order_items"."unit_price", 2))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"order_number" varchar(40) NOT NULL,
	"status" "purchase_order_status" DEFAULT 'DRAFT' NOT NULL,
	"expected_at" timestamp with time zone,
	"notes" text,
	"created_by_staff_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_restaurant_number_key" UNIQUE("restaurant_id","order_number")
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_ingredients_recipe_item_key" UNIQUE("recipe_version_id","inventory_item_id"),
	CONSTRAINT "recipe_ingredients_quantity_check" CHECK ("recipe_ingredients"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "recipe_status" DEFAULT 'DRAFT' NOT NULL,
	"yield_portions" numeric(18, 6) NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_product_version_key" UNIQUE("restaurant_id","product_id","version"),
	CONSTRAINT "recipe_versions_yield_check" CHECK ("recipe_versions"."yield_portions" > 0),
	CONSTRAINT "recipe_versions_period_check" CHECK ("recipe_versions"."effective_to" is null or "recipe_versions"."effective_from" is null or "recipe_versions"."effective_to" > "recipe_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid,
	"customer_name" varchar(160) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"party_size" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"notes" varchar(500),
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_party_check" CHECK ("reservations"."party_size" between 1 and 100),
	CONSTRAINT "reservations_time_check" CHECK ("reservations"."ends_at" > "reservations"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "staff_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"role_label" varchar(80),
	"location_label" varchar(120),
	"notes" varchar(300),
	"status" "schedule_status" DEFAULT 'PLANNED' NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_schedules_time_check" CHECK ("staff_schedules"."ends_at" > "staff_schedules"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"stock_count_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"expected_quantity" numeric(18, 6) NOT NULL,
	"counted_quantity" numeric(18, 6) NOT NULL,
	"variance_quantity" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_lines_count_item_key" UNIQUE("stock_count_id","inventory_item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "stock_count_status" DEFAULT 'DRAFT' NOT NULL,
	"counted_by_staff_id" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_counts_restaurant_id_id_key" UNIQUE("restaurant_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"movement_type" "stock_movement_type" NOT NULL,
	"quantity_delta" numeric(18, 6) NOT NULL,
	"unit_cost" numeric(18, 6),
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid,
	"idempotency_key" varchar(160),
	"reason" varchar(300),
	"actor_staff_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "stock_movements_non_zero_check" CHECK ("stock_movements"."quantity_delta" <> 0),
	CONSTRAINT "stock_movements_unit_cost_check" CHECK ("stock_movements"."unit_cost" is null or "stock_movements"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"goods_receipt_id" uuid,
	"invoice_number" varchar(80) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"paid_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"due_date" date,
	"status" "supplier_invoice_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_restaurant_number_key" UNIQUE("restaurant_id","invoice_number"),
	CONSTRAINT "supplier_invoices_paid_check" CHECK ("supplier_invoices"."paid_total" >= 0 and "supplier_invoices"."paid_total" <= "supplier_invoices"."total")
);
--> statement-breakpoint
CREATE TABLE "supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"supplier_item_code" varchar(80),
	"pack_quantity" numeric(18, 6) NOT NULL,
	"pack_unit" "inventory_unit" NOT NULL,
	"last_unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lead_time_days" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_items_supplier_inventory_key" UNIQUE("supplier_id","inventory_item_id"),
	CONSTRAINT "supplier_items_pack_check" CHECK ("supplier_items"."pack_quantity" > 0),
	CONSTRAINT "supplier_items_lead_time_check" CHECK ("supplier_items"."lead_time_days" is null or "supplier_items"."lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" "supplier_payment_method" NOT NULL,
	"reference" varchar(100),
	"idempotency_key" varchar(160) NOT NULL,
	"paid_by_staff_id" uuid NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "supplier_payments_amount_check" CHECK ("supplier_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"contact_person" varchar(160),
	"phone" varchar(40),
	"email" varchar(254),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_restaurant_id_id_key" UNIQUE("restaurant_id","id")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(40) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "warehouses_restaurant_code_key" UNIQUE("restaurant_id","code")
);
--> statement-breakpoint
CREATE TABLE "waste_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"production_batch_id" uuid,
	"waste_type" "waste_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"estimated_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reason" varchar(300) NOT NULL,
	"recorded_by_staff_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waste_records_restaurant_idempotency_key" UNIQUE("restaurant_id","idempotency_key"),
	CONSTRAINT "waste_records_quantity_check" CHECK ("waste_records"."quantity" > 0),
	CONSTRAINT "waste_records_source_check" CHECK ("waste_records"."inventory_item_id" is not null or "waste_records"."production_batch_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_one_open_staff_key" ON "attendance_records" USING btree ("restaurant_id","staff_id") WHERE "attendance_records"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "attendance_records_restaurant_date_idx" ON "attendance_records" USING btree ("restaurant_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_auth_key" ON "customer_accounts" USING btree ("restaurant_id","auth_user_id") WHERE "customer_accounts"."auth_user_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_accounts_restaurant_active_idx" ON "customer_accounts" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_feedback_session_order_key" ON "customer_feedback" USING btree ("restaurant_id","session_fingerprint_hash","order_id") WHERE "customer_feedback"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_feedback_restaurant_rating_created_idx" ON "customer_feedback" USING btree ("restaurant_id","rating","created_at");--> statement-breakpoint
CREATE INDEX "customer_order_links_customer_idx" ON "customer_order_links" USING btree ("restaurant_id","customer_account_id","linked_at");--> statement-breakpoint
CREATE INDEX "external_transactions_restaurant_status_created_idx" ON "external_transactions" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_requests_order_key" ON "fulfillment_requests" USING btree ("restaurant_id","order_id") WHERE "fulfillment_requests"."order_id" is not null;--> statement-breakpoint
CREATE INDEX "fulfillment_requests_restaurant_channel_status_idx" ON "fulfillment_requests" USING btree ("restaurant_id","channel","status");--> statement-breakpoint
CREATE INDEX "goods_receipt_items_restaurant_inventory_created_idx" ON "goods_receipt_items" USING btree ("restaurant_id","inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "goods_receipts_restaurant_po_idx" ON "goods_receipts" USING btree ("restaurant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "integration_connections_restaurant_enabled_idx" ON "integration_connections" USING btree ("restaurant_id","kind","is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_restaurant_name_key" ON "inventory_items" USING btree ("restaurant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "inventory_items_restaurant_active_idx" ON "inventory_items" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_created_idx" ON "loyalty_ledger" USING btree ("restaurant_id","customer_account_id","created_at");--> statement-breakpoint
CREATE INDEX "payroll_entries_restaurant_period_idx" ON "payroll_entries" USING btree ("restaurant_id","period_start","status");--> statement-breakpoint
CREATE INDEX "popular_product_snapshots_restaurant_rank_idx" ON "popular_product_snapshots" USING btree ("restaurant_id","window_days","rank");--> statement-breakpoint
CREATE INDEX "production_batches_restaurant_date_status_idx" ON "production_batches" USING btree ("restaurant_id","business_date","status");--> statement-breakpoint
CREATE INDEX "purchase_order_items_restaurant_order_idx" ON "purchase_order_items" USING btree ("restaurant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_restaurant_status_created_idx" ON "purchase_orders" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_restaurant_recipe_idx" ON "recipe_ingredients" USING btree ("restaurant_id","recipe_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_versions_one_active_product_key" ON "recipe_versions" USING btree ("restaurant_id","product_id") WHERE "recipe_versions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "recipe_versions_restaurant_effective_idx" ON "recipe_versions" USING btree ("restaurant_id","effective_from");--> statement-breakpoint
CREATE INDEX "reservations_restaurant_time_status_idx" ON "reservations" USING btree ("restaurant_id","starts_at","status");--> statement-breakpoint
CREATE INDEX "reservations_restaurant_table_time_idx" ON "reservations" USING btree ("restaurant_id","table_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_schedules_restaurant_staff_time_idx" ON "staff_schedules" USING btree ("restaurant_id","staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "stock_count_lines_restaurant_count_idx" ON "stock_count_lines" USING btree ("restaurant_id","stock_count_id");--> statement-breakpoint
CREATE INDEX "stock_counts_restaurant_warehouse_created_idx" ON "stock_counts" USING btree ("restaurant_id","warehouse_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_restaurant_idempotency_key" ON "stock_movements" USING btree ("restaurant_id","idempotency_key") WHERE "stock_movements"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "stock_movements_item_warehouse_created_idx" ON "stock_movements" USING btree ("restaurant_id","inventory_item_id","warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "supplier_invoices_restaurant_supplier_status_idx" ON "supplier_invoices" USING btree ("restaurant_id","supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_items_restaurant_inventory_idx" ON "supplier_items" USING btree ("restaurant_id","inventory_item_id");--> statement-breakpoint
CREATE INDEX "supplier_payments_restaurant_invoice_idx" ON "supplier_payments" USING btree ("restaurant_id","supplier_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_restaurant_name_key" ON "suppliers" USING btree ("restaurant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "suppliers_restaurant_active_idx" ON "suppliers" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE INDEX "warehouses_restaurant_active_idx" ON "warehouses" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE INDEX "waste_records_restaurant_occurred_idx" ON "waste_records" USING btree ("restaurant_id","occurred_at");--> statement-breakpoint

-- Phase 38 tenant-integrity addendum. Composite foreign keys make a row from
-- restaurant A incapable of referencing an entity owned by restaurant B.
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_restaurant_id_id_key" UNIQUE ("restaurant_id", "id");--> statement-breakpoint

ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_restaurant_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_restaurant_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restaurant_warehouse_fk" FOREIGN KEY ("restaurant_id", "warehouse_id") REFERENCES "warehouses"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restaurant_actor_fk" FOREIGN KEY ("restaurant_id", "actor_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_restaurant_warehouse_fk" FOREIGN KEY ("restaurant_id", "warehouse_id") REFERENCES "warehouses"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_restaurant_counter_fk" FOREIGN KEY ("restaurant_id", "counted_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_restaurant_count_fk" FOREIGN KEY ("restaurant_id", "stock_count_id") REFERENCES "stock_counts"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_restaurant_product_fk" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "products"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_restaurant_creator_fk" FOREIGN KEY ("restaurant_id", "created_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_restaurant_recipe_fk" FOREIGN KEY ("restaurant_id", "recipe_version_id") REFERENCES "recipe_versions"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_restaurant_product_fk" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "products"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_restaurant_recipe_fk" FOREIGN KEY ("restaurant_id", "recipe_version_id") REFERENCES "recipe_versions"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_restaurant_warehouse_fk" FOREIGN KEY ("restaurant_id", "warehouse_id") REFERENCES "warehouses"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_restaurant_producer_fk" FOREIGN KEY ("restaurant_id", "produced_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_restaurant_warehouse_fk" FOREIGN KEY ("restaurant_id", "warehouse_id") REFERENCES "warehouses"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_restaurant_batch_fk" FOREIGN KEY ("restaurant_id", "production_batch_id") REFERENCES "production_batches"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_restaurant_recorder_fk" FOREIGN KEY ("restaurant_id", "recorded_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_restaurant_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_restaurant_supplier_fk" FOREIGN KEY ("restaurant_id", "supplier_id") REFERENCES "suppliers"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_restaurant_supplier_fk" FOREIGN KEY ("restaurant_id", "supplier_id") REFERENCES "suppliers"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_restaurant_creator_fk" FOREIGN KEY ("restaurant_id", "created_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "purchase_order_id") REFERENCES "purchase_orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "purchase_order_id") REFERENCES "purchase_orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_restaurant_supplier_fk" FOREIGN KEY ("restaurant_id", "supplier_id") REFERENCES "suppliers"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_restaurant_warehouse_fk" FOREIGN KEY ("restaurant_id", "warehouse_id") REFERENCES "warehouses"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_restaurant_receiver_fk" FOREIGN KEY ("restaurant_id", "received_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_restaurant_receipt_fk" FOREIGN KEY ("restaurant_id", "goods_receipt_id") REFERENCES "goods_receipts"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_restaurant_po_item_fk" FOREIGN KEY ("restaurant_id", "purchase_order_item_id") REFERENCES "purchase_order_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_restaurant_item_fk" FOREIGN KEY ("restaurant_id", "inventory_item_id") REFERENCES "inventory_items"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_restaurant_supplier_fk" FOREIGN KEY ("restaurant_id", "supplier_id") REFERENCES "suppliers"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_restaurant_receipt_fk" FOREIGN KEY ("restaurant_id", "goods_receipt_id") REFERENCES "goods_receipts"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_restaurant_supplier_fk" FOREIGN KEY ("restaurant_id", "supplier_id") REFERENCES "suppliers"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_restaurant_invoice_fk" FOREIGN KEY ("restaurant_id", "supplier_invoice_id") REFERENCES "supplier_invoices"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_restaurant_staff_fk" FOREIGN KEY ("restaurant_id", "paid_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_restaurant_staff_fk" FOREIGN KEY ("restaurant_id", "staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_restaurant_corrector_fk" FOREIGN KEY ("restaurant_id", "corrected_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_restaurant_staff_fk" FOREIGN KEY ("restaurant_id", "staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_restaurant_creator_fk" FOREIGN KEY ("restaurant_id", "created_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_restaurant_staff_fk" FOREIGN KEY ("restaurant_id", "staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_restaurant_approver_fk" FOREIGN KEY ("restaurant_id", "approved_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_restaurant_table_fk" FOREIGN KEY ("restaurant_id", "table_id") REFERENCES "restaurant_tables"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_restaurant_reviewer_fk" FOREIGN KEY ("restaurant_id", "reviewed_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_table_fk" FOREIGN KEY ("restaurant_id", "table_id") REFERENCES "restaurant_tables"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_creator_fk" FOREIGN KEY ("restaurant_id", "created_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fulfillment_requests" ADD CONSTRAINT "fulfillment_requests_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fulfillment_requests" ADD CONSTRAINT "fulfillment_requests_restaurant_courier_fk" FOREIGN KEY ("restaurant_id", "courier_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_restaurant_fk" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_order_links" ADD CONSTRAINT "customer_order_links_restaurant_customer_fk" FOREIGN KEY ("restaurant_id", "customer_account_id") REFERENCES "customer_accounts"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer_order_links" ADD CONSTRAINT "customer_order_links_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_restaurant_customer_fk" FOREIGN KEY ("restaurant_id", "customer_account_id") REFERENCES "customer_accounts"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_restaurant_order_fk" FOREIGN KEY ("restaurant_id", "order_id") REFERENCES "orders"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_restaurant_actor_fk" FOREIGN KEY ("restaurant_id", "actor_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "popular_product_snapshots" ADD CONSTRAINT "popular_product_snapshots_restaurant_product_fk" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "products"("restaurant_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_restaurant_creator_fk" FOREIGN KEY ("restaurant_id", "created_by_staff_id") REFERENCES "staff_profiles"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "external_transactions" ADD CONSTRAINT "external_transactions_restaurant_connection_fk" FOREIGN KEY ("restaurant_id", "integration_connection_id") REFERENCES "integration_connections"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint

-- Browser/Data API access is denied. All ERP access goes through server routes
-- that first resolve an ADMIN/MANAGER tenant principal.
REVOKE ALL ON TABLE
  "attendance_records", "customer_accounts", "customer_feedback", "customer_order_links",
  "external_transactions", "fulfillment_requests", "goods_receipt_items", "goods_receipts",
  "integration_connections", "inventory_items", "loyalty_ledger", "payroll_entries",
  "popular_product_snapshots", "production_batches", "purchase_order_items", "purchase_orders",
  "recipe_ingredients", "recipe_versions", "reservations", "staff_schedules", "stock_count_lines",
  "stock_counts", "stock_movements", "supplier_invoices", "supplier_items", "supplier_payments",
  "suppliers", "warehouses", "waste_records"
FROM anon, authenticated;--> statement-breakpoint

ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer_accounts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer_feedback" ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer_order_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_transactions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "fulfillment_requests" ENABLE ROW LEVEL SECURITY; ALTER TABLE "goods_receipt_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY; ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "loyalty_ledger" ENABLE ROW LEVEL SECURITY; ALTER TABLE "payroll_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "popular_product_snapshots" ENABLE ROW LEVEL SECURITY; ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY; ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ENABLE ROW LEVEL SECURITY; ALTER TABLE "recipe_versions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY; ALTER TABLE "staff_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY; ALTER TABLE "supplier_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY; ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY; ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY; ALTER TABLE "waste_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TRIGGER "warehouses_set_updated_at" BEFORE UPDATE ON "warehouses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "inventory_items_set_updated_at" BEFORE UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "stock_counts_set_updated_at" BEFORE UPDATE ON "stock_counts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "recipe_versions_set_updated_at" BEFORE UPDATE ON "recipe_versions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "production_batches_set_updated_at" BEFORE UPDATE ON "production_batches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "suppliers_set_updated_at" BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "supplier_items_set_updated_at" BEFORE UPDATE ON "supplier_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "purchase_orders_set_updated_at" BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "purchase_order_items_set_updated_at" BEFORE UPDATE ON "purchase_order_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "supplier_invoices_set_updated_at" BEFORE UPDATE ON "supplier_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "attendance_records_set_updated_at" BEFORE UPDATE ON "attendance_records" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "staff_schedules_set_updated_at" BEFORE UPDATE ON "staff_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "payroll_entries_set_updated_at" BEFORE UPDATE ON "payroll_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "customer_feedback_set_updated_at" BEFORE UPDATE ON "customer_feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "reservations_set_updated_at" BEFORE UPDATE ON "reservations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "fulfillment_requests_set_updated_at" BEFORE UPDATE ON "fulfillment_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "customer_accounts_set_updated_at" BEFORE UPDATE ON "customer_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "integration_connections_set_updated_at" BEFORE UPDATE ON "integration_connections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "external_transactions_set_updated_at" BEFORE UPDATE ON "external_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
