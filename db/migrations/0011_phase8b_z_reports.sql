ALTER TABLE "cashier_shifts" ADD COLUMN "z_report_version" integer;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "z_report_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD COLUMN "z_report_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "cashier_shifts_z_report_idx" ON "cashier_shifts" USING btree ("restaurant_id","z_report_generated_at") WHERE "cashier_shifts"."z_report_snapshot" is not null;--> statement-breakpoint
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_z_snapshot_consistency_check" CHECK ((
        "cashier_shifts"."z_report_snapshot" is null
        and "cashier_shifts"."z_report_version" is null
        and "cashier_shifts"."z_report_generated_at" is null
      ) or (
        "cashier_shifts"."z_report_snapshot" is not null
        and "cashier_shifts"."z_report_version" is not null
        and "cashier_shifts"."z_report_generated_at" is not null
        and "cashier_shifts"."status" = 'CLOSED'
      ));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Phase 8B addendum.
--
-- Fully additive: three nullable columns on `cashier_shifts`, one partial
-- index and one check constraint. No table is created, nothing is dropped and
-- no existing row is rewritten.
--
-- Shifts closed before this migration keep all three columns NULL. That means
-- LEGACY — they have no stored operational Z report and none is reconstructed
-- for them, because a report invented after the fact would be
-- indistinguishable from one taken at the counter. The check constraint above
-- is written to accept exactly that state.
--
-- `cashier_shifts` already holds no grants for `anon`/`authenticated` and has
-- row-level security enabled (migration 0010), so the snapshot inherits the
-- same server-only boundary as the rest of the shift row.
-- ---------------------------------------------------------------------------
