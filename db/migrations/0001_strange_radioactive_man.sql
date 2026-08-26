CREATE TABLE "api_rate_limits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_rate_limits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key_hash" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_rate_limits_expiry_check" CHECK ("api_rate_limits"."expires_at" > "api_rate_limits"."created_at")
);
--> statement-breakpoint
CREATE INDEX "api_rate_limits_key_created_idx" ON "api_rate_limits" USING btree ("key_hash","created_at");--> statement-breakpoint
CREATE INDEX "api_rate_limits_expires_idx" ON "api_rate_limits" USING btree ("expires_at");--> statement-breakpoint

-- This infrastructure table is written only through the trusted Next.js API.
-- Browser roles receive no privileges or policies, so enabling RLS is fail-closed.
REVOKE ALL ON TABLE "api_rate_limits" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON SEQUENCE "api_rate_limits_id_seq" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "api_rate_limits" ENABLE ROW LEVEL SECURITY;
