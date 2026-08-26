ALTER TABLE "api_rate_limits" ADD COLUMN "request_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH "consolidated_rate_limits" AS (
	SELECT
		"key_hash",
		max("id") AS "keeper_id",
		min("created_at") AS "created_at",
		max("expires_at") AS "expires_at",
		least(count(*), 2147483647)::integer AS "request_count"
	FROM "api_rate_limits"
	GROUP BY "key_hash"
	HAVING count(*) > 1
), "updated_rate_limits" AS (
	UPDATE "api_rate_limits" AS "rate_limit"
	SET
		"created_at" = "consolidated"."created_at",
		"expires_at" = "consolidated"."expires_at",
		"request_count" = "consolidated"."request_count"
	FROM "consolidated_rate_limits" AS "consolidated"
	WHERE "rate_limit"."id" = "consolidated"."keeper_id"
	RETURNING "rate_limit"."id"
)
DELETE FROM "api_rate_limits" AS "duplicate"
USING "consolidated_rate_limits" AS "consolidated"
WHERE
	"duplicate"."key_hash" = "consolidated"."key_hash"
	AND "duplicate"."id" <> "consolidated"."keeper_id";--> statement-breakpoint
CREATE UNIQUE INDEX "api_rate_limits_key_hash_key" ON "api_rate_limits" USING btree ("key_hash");--> statement-breakpoint
ALTER TABLE "api_rate_limits" ADD CONSTRAINT "api_rate_limits_request_count_check" CHECK ("api_rate_limits"."request_count" > 0);
