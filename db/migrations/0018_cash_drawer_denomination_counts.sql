CREATE TYPE "public"."cash_count_phase" AS ENUM('OPENING', 'CLOSING');--> statement-breakpoint
CREATE TABLE "cashier_shift_cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"phase" "cash_count_phase" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"denomination_minor" integer NOT NULL,
	"piece_count" integer NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"counted_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashier_shift_cash_counts_unique_key" UNIQUE("shift_id","phase","currency","denomination_minor"),
	CONSTRAINT "cashier_shift_cash_counts_currency_check" CHECK ("cashier_shift_cash_counts"."currency" in ('TRY', 'EUR', 'USD')),
	CONSTRAINT "cashier_shift_cash_counts_denomination_check" CHECK ("cashier_shift_cash_counts"."denomination_minor" > 0),
	CONSTRAINT "cashier_shift_cash_counts_piece_check" CHECK ("cashier_shift_cash_counts"."piece_count" > 0 and "cashier_shift_cash_counts"."piece_count" <= 100000),
	CONSTRAINT "cashier_shift_cash_counts_subtotal_check" CHECK ("cashier_shift_cash_counts"."subtotal_minor" = "cashier_shift_cash_counts"."denomination_minor"::bigint * "cashier_shift_cash_counts"."piece_count"::bigint)
);
--> statement-breakpoint
ALTER TABLE "cashier_shift_cash_counts" ADD CONSTRAINT "cashier_shift_cash_counts_shift_fk" FOREIGN KEY ("restaurant_id","shift_id") REFERENCES "public"."cashier_shifts"("restaurant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashier_shift_cash_counts" ADD CONSTRAINT "cashier_shift_cash_counts_staff_fk" FOREIGN KEY ("restaurant_id","counted_by_staff_id") REFERENCES "public"."staff_profiles"("restaurant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cashier_shift_cash_counts_shift_phase_idx" ON "cashier_shift_cash_counts" USING btree ("restaurant_id","shift_id","phase");