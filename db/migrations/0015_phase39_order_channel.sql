-- Phase 39: orders learn where they are served.
--
-- Until now every order was a dine-in order, so `table_id` could be NOT NULL
-- and the table was the order's identity. Takeaway and courier orders have no
-- table. Rather than invent one -- which would put a fake row on the floor
-- plan, in the occupancy figures and in every table report -- the order itself
-- now says which channel it belongs to, and the pairing is an invariant.
--
-- Additive and backfill-safe: the new column defaults to DINE_IN, which is
-- what every existing row already is, so the CHECK added afterwards is
-- satisfied by the whole table without touching a single row by hand.
--
-- The CHECK is added validating, which scans the table once under an
-- ACCESS EXCLUSIVE lock. That is the right trade at this size; if `orders`
-- ever grows past a comfortable scan, split it into ADD CONSTRAINT ... NOT
-- VALID followed by VALIDATE CONSTRAINT to keep the lock short.

ALTER TABLE "orders" ALTER COLUMN "table_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" "order_channel" DEFAULT 'DINE_IN' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_table_check" CHECK (("orders"."channel" = 'DINE_IN' and "orders"."table_id" is not null) or ("orders"."channel" in ('TAKEAWAY', 'DELIVERY') and "orders"."table_id" is null));