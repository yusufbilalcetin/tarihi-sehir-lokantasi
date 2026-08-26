import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../db/migrations/0004_far_colossus.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../../db/schema.ts", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../../lib/security/rate-limit.server.ts", import.meta.url),
  "utf8",
);

test("distributed rate-limit schema matches its atomic upsert contract", () => {
  assert.match(migration, /ADD COLUMN "request_count" integer DEFAULT 1 NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX "api_rate_limits_key_hash_key"/);
  assert.match(migration, /consolidated_rate_limits/);
  assert.match(migration, /GROUP BY "key_hash"/);
  assert.match(migration, /DELETE FROM "api_rate_limits" AS "duplicate"/);
  assert.ok(
    migration.indexOf("consolidated_rate_limits") <
      migration.indexOf('CREATE UNIQUE INDEX "api_rate_limits_key_hash_key"'),
    "legacy duplicate keys must be consolidated before the unique index is created",
  );
  assert.match(schema, /requestCount: integer\("request_count"\)\.default\(1\)\.notNull\(\)/);
  assert.match(schema, /uniqueIndex\("api_rate_limits_key_hash_key"\)\.on\(table\.keyHash\)/);
  assert.match(runtime, /ON CONFLICT \(key_hash\) DO UPDATE/);
  assert.match(runtime, /request_count <= \$\{limit\} AS accepted/);
  assert.match(runtime, /WHERE expires_at <= now\(\)/);
  assert.match(runtime, /LIMIT 100\s+FOR UPDATE SKIP LOCKED/);
  assert.match(runtime, /action === "STAFF_LOGIN" && scope\.identifier/);
  assert.match(runtime, /actorId: privacyFingerprint\(clientAddress\(request\)\)/);
});
