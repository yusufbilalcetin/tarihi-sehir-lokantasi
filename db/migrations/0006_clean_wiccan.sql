-- One live payment per order. Additive and re-runnable; it deliberately fails
-- loudly if historical duplicates exist, because silently deleting a payment
-- row would destroy a financial record.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_one_active_per_order_key" ON "payments" USING btree ("restaurant_id","order_id") WHERE "payments"."status" in ('PENDING', 'COMPLETED');
