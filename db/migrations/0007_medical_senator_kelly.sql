-- Additive dead-letter marker for the outbox worker. Re-runnable and safe on
-- an existing table: the column is nullable and the index is partial.
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_dead_letter_idx" ON "outbox_events" USING btree ("restaurant_id","dead_lettered_at") WHERE "outbox_events"."dead_lettered_at" is not null;
