CREATE TABLE "fulfillment_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"fulfillment_request_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" varchar(180) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_request_items_request_product_key" UNIQUE("fulfillment_request_id","product_id"),
	CONSTRAINT "fulfillment_request_items_quantity_check" CHECK ("fulfillment_request_items"."quantity" between 1 and 99),
	CONSTRAINT "fulfillment_request_items_total_check" CHECK ("fulfillment_request_items"."line_total" = round("fulfillment_request_items"."unit_price" * "fulfillment_request_items"."quantity", 2))
);
--> statement-breakpoint
CREATE INDEX "fulfillment_request_items_restaurant_request_idx" ON "fulfillment_request_items" USING btree ("restaurant_id","fulfillment_request_id");--> statement-breakpoint
ALTER TABLE "fulfillment_requests" ADD CONSTRAINT "fulfillment_requests_restaurant_id_id_key" UNIQUE("restaurant_id","id");--> statement-breakpoint

-- Tenant references are composite, as everywhere else in this schema: a line
-- cannot point at another restaurant's request or another restaurant's product,
-- because the restaurant travels inside the foreign key itself.
ALTER TABLE "fulfillment_request_items" ADD CONSTRAINT "fulfillment_request_items_restaurant_request_fk" FOREIGN KEY ("restaurant_id", "fulfillment_request_id") REFERENCES "fulfillment_requests"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fulfillment_request_items" ADD CONSTRAINT "fulfillment_request_items_restaurant_product_fk" FOREIGN KEY ("restaurant_id", "product_id") REFERENCES "products"("restaurant_id", "id") ON DELETE RESTRICT;--> statement-breakpoint

-- Browser/Data API access is denied. Order lines carry what a customer was
-- charged, so they reach the client only through a server route that has
-- already resolved an ADMIN/MANAGER tenant principal.
REVOKE ALL ON TABLE "fulfillment_request_items" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "fulfillment_request_items" ENABLE ROW LEVEL SECURITY;
