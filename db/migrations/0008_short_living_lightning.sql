-- Phase 6 additive migration. Nothing is dropped or narrowed.
--
-- 1. Two order-event names so appending and cancelling a line appear on the
--    order timeline instead of being folded into a generic status change.
-- 2. The service/tax rates the order was opened with. Recalculating an order
--    after a later settings change must not re-price the round the guest
--    already agreed to. Nullable on purpose: rows written before this column
--    existed keep falling back to the restaurant settings.
ALTER TYPE "public"."order_event_type" ADD VALUE IF NOT EXISTS 'ORDER_ITEMS_ADDED';--> statement-breakpoint
ALTER TYPE "public"."order_event_type" ADD VALUE IF NOT EXISTS 'ORDER_ITEM_CANCELLED';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "service_fee_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(5, 2);--> statement-breakpoint
DO $phase6$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_service_fee_rate_check'
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_service_fee_rate_check"
      CHECK ("orders"."service_fee_rate" is null or "orders"."service_fee_rate" between 0 and 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_tax_rate_check'
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_tax_rate_check"
      CHECK ("orders"."tax_rate" is null or "orders"."tax_rate" between 0 and 100);
  END IF;
END
$phase6$;
