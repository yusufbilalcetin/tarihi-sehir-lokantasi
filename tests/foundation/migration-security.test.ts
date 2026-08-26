import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../db/migrations/0000_central_restaurant_foundation.sql", import.meta.url),
  "utf8",
);

test("initial migration is additive and enables RLS on every foundation table", () => {
  assert.doesNotMatch(migration, /^\s*DROP\s+(?:TABLE|COLUMN)\b/im);
  assert.equal(
    migration.match(/ALTER TABLE "[^"]+" ENABLE ROW LEVEL SECURITY/g)?.length,
    16,
  );
});

test("browser grants and realtime publication never expose QR hashes or payments", () => {
  const selectGrant = migration.match(/GRANT SELECT ON TABLE([\s\S]*?)TO authenticated;/)?.[1];
  assert.ok(selectGrant);
  assert.doesNotMatch(selectGrant, /"restaurant_tables"/);
  assert.doesNotMatch(selectGrant, /"payments"/);

  const realtimeTables = migration.match(/FOREACH realtime_table IN ARRAY ARRAY\[([\s\S]*?)\]/)?.[1];
  assert.ok(realtimeTables);
  assert.doesNotMatch(realtimeTables, /'restaurant_tables'/);
});

test("tenant read policies require an active parent restaurant", () => {
  assert.match(migration, /restaurants\.is_active/);
  assert.match(
    migration,
    /active_restaurant\.id = membership\.restaurant_id AND active_restaurant\.is_active/,
  );
});
