CREATE TYPE "public"."cash_movement_type" AS ENUM('CASH_IN', 'CASH_OUT');--> statement-breakpoint
CREATE TYPE "public"."cashier_shift_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "cash_drawer_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"cashier_shift_id" uuid NOT NULL,
	"type" "cash_movement_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" varchar(120) NOT NULL,
	"note" varchar(500),
	"created_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_drawer_movements_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "cash_drawer_movements_amount_check" CHECK ("cash_drawer_movements"."amount" > 0),
	CONSTRAINT "cash_drawer_movements_reason_check" CHECK (length(btrim("cash_drawer_movements"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"code" varchar(40) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_registers_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "cash_registers_restaurant_code_key" UNIQUE("restaurant_id","code"),
	CONSTRAINT "cash_registers_code_format_check" CHECK ("cash_registers"."code" ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
	CONSTRAINT "cash_registers_name_check" CHECK (length(btrim("cash_registers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "cashier_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	"register_name_snapshot" varchar(80) NOT NULL,
	"opened_by_staff_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_cash" numeric(12, 2) NOT NULL,
	"status" "cashier_shift_status" DEFAULT 'OPEN' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_staff_id" uuid,
	"counted_cash_at_close" numeric(12, 2),
	"expected_cash_at_close" numeric(12, 2),
	"cash_variance" numeric(12, 2),
	"close_note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashier_shifts_restaurant_id_id_key" UNIQUE("restaurant_id","id"),
	CONSTRAINT "cashier_shifts_opening_cash_check" CHECK ("cashier_shifts"."opening_cash" >= 0),
	CONSTRAINT "cashier_shifts_counted_cash_check" CHECK ("cashier_shifts"."counted_cash_at_close" is null or "cashier_shifts"."counted_cash_at_close" >= 0),
	CONSTRAINT "cashier_shifts_closure_consistency_check" CHECK ((
        "cashier_shifts"."status" = 'OPEN'
        and "cashier_shifts"."closed_at" is null
        and "cashier_shifts"."closed_by_staff_id" is null
        and "cashier_shifts"."counted_cash_at_close" is null
        and "cashier_shifts"."expected_cash_at_close" is null
        and "cashier_shifts"."cash_variance" is null
      ) or (
        "cashier_shifts"."status" = 'CLOSED'
        and "cashier_shifts"."closed_at" is not null
        and "cashier_shifts"."closed_by_staff_id" is not null
        and "cashier_shifts"."counted_cash_at_close" is not null
        and "cashier_shifts"."expected_cash_at_close" is not null
        and "cashier_shifts"."cash_variance" is not null
        and "cashier_shifts"."cash_variance" = "cashier_shifts"."counted_cash_at_close" - "cashier_shifts"."expected_cash_at_close"
      ))
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "cashier_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "cashier_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_restaurant_shift_fk" FOREIGN KEY ("restaurant_id","cashier_shift_id") REFERENCES "public"."cashier_shifts"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_restaurant_creator_fk" FOREIGN KEY ("restaurant_id","created_by_staff_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_restaurant_register_fk" FOREIGN KEY ("restaurant_id","cash_register_id") REFERENCES "public"."cash_registers"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_restaurant_opener_fk" FOREIGN KEY ("restaurant_id","opened_by_staff_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_restaurant_closer_fk" FOREIGN KEY ("restaurant_id","closed_by_staff_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_drawer_movements_shift_created_idx" ON "cash_drawer_movements" USING btree ("restaurant_id","cashier_shift_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_registers_restaurant_active_idx" ON "cash_registers" USING btree ("restaurant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_register_key" ON "cashier_shifts" USING btree ("restaurant_id","cash_register_id") WHERE "cashier_shifts"."status" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_staff_key" ON "cashier_shifts" USING btree ("restaurant_id","opened_by_staff_id") WHERE "cashier_shifts"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "cashier_shifts_restaurant_status_opened_idx" ON "cashier_shifts" USING btree ("restaurant_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "cashier_shifts_restaurant_opener_opened_idx" ON "cashier_shifts" USING btree ("restaurant_id","opened_by_staff_id","opened_at");--> statement-breakpoint
CREATE INDEX "cashier_shifts_restaurant_register_opened_idx" ON "cashier_shifts" USING btree ("restaurant_id","cash_register_id","opened_at");--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_restaurant_shift_fk" FOREIGN KEY ("restaurant_id","cashier_shift_id") REFERENCES "public"."cashier_shifts"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_shift_fk" FOREIGN KEY ("restaurant_id","cashier_shift_id") REFERENCES "public"."cashier_shifts"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_restaurant_shift_idx" ON "payment_refunds" USING btree ("restaurant_id","cashier_shift_id") WHERE "payment_refunds"."cashier_shift_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_restaurant_shift_idx" ON "payments" USING btree ("restaurant_id","cashier_shift_id") WHERE "payments"."cashier_shift_id" is not null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Phase 8A security addendum (hand-written; Drizzle does not generate these).
--
-- Everything above is additive: two enums, three tables, two nullable columns
-- on payments/payment_refunds, their composite tenant FKs and indexes. No
-- column or table is dropped and no existing row is rewritten. Historical
-- payments and refunds keep a NULL cashier_shift_id, which means LEGACY /
-- PRE-SHIFT; they are deliberately never back-filled with an invented shift.
-- ---------------------------------------------------------------------------

-- Least privilege for the browser roles, matching migration 0000. The
-- financial tables added in 0009 are included here because that migration
-- omitted the revoke and inherited Supabase's schema defaults, leaving
-- REFERENCES/TRIGGER/TRUNCATE granted to anon and authenticated. TRUNCATE in
-- particular is not constrained by row-level security.
REVOKE ALL ON TABLE
  "cash_registers",
  "cashier_shifts",
  "cash_drawer_movements",
  "payment_refunds",
  "order_checks",
  "order_check_items"
FROM anon, authenticated;--> statement-breakpoint

-- No SELECT is granted to `authenticated`: cash accountability is read through
-- the server, never straight off the Data API.
ALTER TABLE "cash_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_drawer_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_check_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE TRIGGER "cash_registers_set_updated_at"
BEFORE UPDATE ON "cash_registers"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "cashier_shifts_set_updated_at"
BEFORE UPDATE ON "cashier_shifts"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
