-- Phase 7 financial migration. READ THE DROP BELOW BEFORE APPLYING.
--
-- ⚠ DESTRUCTIVE LINE: `DROP INDEX "payments_one_active_per_order_key"`.
--   That partial unique index enforced "at most one PENDING/COMPLETED payment
--   per order" and was Phase 4's database-level guard against double
--   collection. Split bills and cash+card settlement make that invariant false,
--   so it has to go. It is replaced by two guards:
--     1. `payments_restaurant_idempotency_key` — a unique index on the request's
--        idempotency hash, so a retried collection cannot insert twice.
--     2. A server-derived balance taken under `SELECT ... FOR UPDATE` on the
--        order, which rejects any collection exceeding what is still owed.
--   Rolling this migration back re-creates the old index; that will FAIL if any
--   order has meanwhile collected more than one live payment. Take a backup of
--   `payments` first and verify with:
--     SELECT restaurant_id, order_id, count(*) FROM payments
--     WHERE status IN ('PENDING','COMPLETED')
--     GROUP BY 1,2 HAVING count(*) > 1;
--
-- Everything else here is additive: four enums, five order-event values, the
-- VOIDED item status, void bookkeeping columns, an optional payment.check_id,
-- and the payment_refunds / order_checks / order_check_items tables. No column
-- or table is dropped and no data is rewritten.
CREATE TYPE "public"."order_check_status" AS ENUM('OPEN', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."refund_reason_code" AS ENUM('CUSTOMER_COMPLAINT', 'WRONG_CHARGE', 'QUALITY_ISSUE', 'STAFF_ERROR', 'OVERPAYMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."void_reason_code" AS ENUM('CUSTOMER_COMPLAINT', 'WRONG_ITEM', 'QUALITY_ISSUE', 'STAFF_ERROR', 'MANAGER_COMP', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'ORDER_ITEM_VOIDED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'PAYMENT_RECORDED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'PAYMENT_REFUNDED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'CHECK_CREATED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE 'CHECK_PAID';--> statement-breakpoint
ALTER TYPE "public"."order_item_status" ADD VALUE 'VOIDED';--> statement-breakpoint
CREATE TABLE "order_check_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"check_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_snapshot" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_check_items_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "order_check_items_check_item_key" UNIQUE("check_id","order_item_id"),
	CONSTRAINT "order_check_items_quantity_check" CHECK ("order_check_items"."quantity" between 1 and 99),
	CONSTRAINT "order_check_items_unit_price_check" CHECK ("order_check_items"."unit_price_snapshot" >= 0),
	CONSTRAINT "order_check_items_line_total_formula_check" CHECK ("order_check_items"."line_total" = "order_check_items"."unit_price_snapshot" * "order_check_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"label" varchar(80) NOT NULL,
	"status" "order_check_status" DEFAULT 'OPEN' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_checks_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "order_checks_total_check" CHECK ("order_checks"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason_code" "refund_reason_code" NOT NULL,
	"note" varchar(300),
	"status" "refund_status" DEFAULT 'COMPLETED' NOT NULL,
	"external_reference" varchar(255),
	"created_by_user_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "payment_refunds_amount_check" CHECK ("payment_refunds"."amount" > 0)
);
--> statement-breakpoint
DROP INDEX "payments_one_active_per_order_key";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "void_reason_code" "void_reason_code";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "check_id" uuid;--> statement-breakpoint
ALTER TABLE "order_check_items" ADD CONSTRAINT "order_check_items_restaurant_check_fk" FOREIGN KEY ("restaurant_id","check_id") REFERENCES "public"."order_checks"("restaurant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_check_items" ADD CONSTRAINT "order_check_items_restaurant_item_fk" FOREIGN KEY ("restaurant_id","order_item_id") REFERENCES "public"."order_items"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checks" ADD CONSTRAINT "order_checks_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_checks" ADD CONSTRAINT "order_checks_restaurant_creator_fk" FOREIGN KEY ("restaurant_id","created_by_user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_restaurant_payment_fk" FOREIGN KEY ("restaurant_id","payment_id") REFERENCES "public"."payments"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_restaurant_order_fk" FOREIGN KEY ("restaurant_id","order_id") REFERENCES "public"."orders"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_restaurant_creator_fk" FOREIGN KEY ("restaurant_id","created_by_user_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_check_items_restaurant_item_idx" ON "order_check_items" USING btree ("restaurant_id","order_item_id");--> statement-breakpoint
CREATE INDEX "order_checks_restaurant_order_idx" ON "order_checks" USING btree ("restaurant_id","order_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_restaurant_idempotency_key" ON "payment_refunds" USING btree ("restaurant_id",("metadata" ->> 'idempotencyKeyHash')) WHERE "payment_refunds"."metadata" ->> 'idempotencyKeyHash' is not null;--> statement-breakpoint
CREATE INDEX "payment_refunds_restaurant_created_idx" ON "payment_refunds" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_refunds_restaurant_payment_idx" ON "payment_refunds" USING btree ("restaurant_id","payment_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurant_voider_fk" FOREIGN KEY ("restaurant_id","voided_by") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_restaurant_voided_idx" ON "order_items" USING btree ("restaurant_id","voided_at") WHERE "order_items"."voided_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_restaurant_idempotency_key" ON "payments" USING btree ("restaurant_id",("metadata" ->> 'idempotencyKeyHash')) WHERE "payments"."metadata" ->> 'idempotencyKeyHash' is not null;