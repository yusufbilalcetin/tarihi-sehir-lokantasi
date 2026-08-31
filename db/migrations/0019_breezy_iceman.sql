CREATE TABLE "category_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"locale" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_translations_restaurant_category_locale_key" UNIQUE("restaurant_id","category_id","locale"),
	CONSTRAINT "category_translations_locale_format_check" CHECK ("category_translations"."locale" ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'),
	CONSTRAINT "category_translations_name_not_blank_check" CHECK (length(btrim("category_translations"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "product_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"locale" varchar(16) NOT NULL,
	"name" varchar(180) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_translations_restaurant_product_locale_key" UNIQUE("restaurant_id","product_id","locale"),
	CONSTRAINT "product_translations_locale_format_check" CHECK ("product_translations"."locale" ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'),
	CONSTRAINT "product_translations_name_not_blank_check" CHECK (length(btrim("product_translations"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_restaurant_category_fk" FOREIGN KEY ("restaurant_id","category_id") REFERENCES "public"."categories"("restaurant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_restaurant_product_fk" FOREIGN KEY ("restaurant_id","product_id") REFERENCES "public"."products"("restaurant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_translations_restaurant_locale_idx" ON "category_translations" USING btree ("restaurant_id","locale","category_id");--> statement-breakpoint
CREATE INDEX "product_translations_restaurant_locale_idx" ON "product_translations" USING btree ("restaurant_id","locale","product_id");