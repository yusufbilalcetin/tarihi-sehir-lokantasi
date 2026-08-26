import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../db/migrations/0003_phase3_supabase_permissions.sql", import.meta.url),
  "utf8",
);
const journal = readFileSync(
  new URL("../../db/migrations/meta/_journal.json", import.meta.url),
  "utf8",
);

test("Phase 3 policy migration is additive, journaled, and portable to plain PostgreSQL", () => {
  assert.doesNotMatch(migration, /^\s*DROP\s+(?:TABLE|COLUMN)\b/im);
  assert.match(migration, /to_regclass\('realtime\.messages'\) IS NOT NULL/);
  assert.match(migration, /to_regclass\('storage\.objects'\) IS NOT NULL/);
  assert.match(journal, /0003_phase3_supabase_permissions/);
});

test("private Realtime subscription is restaurant scoped and browser publishing stays closed", () => {
  const realtimeBlock = migration.split("-- Product image objects live at:")[0] ?? "";
  assert.match(realtimeBlock, /FOR SELECT\s+TO authenticated/);
  assert.match(realtimeBlock, /"extension" = 'broadcast'/);
  assert.match(realtimeBlock, /realtime\.topic\(\)/);
  assert.match(realtimeBlock, /membership\.restaurant_id::text/);
  assert.match(realtimeBlock, /membership\.auth_user_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(realtimeBlock, /membership\.is_active/);
  assert.doesNotMatch(realtimeBlock, /FOR INSERT\s+TO authenticated/);
});

test("product-image metadata writes require active ADMIN or MANAGER membership", () => {
  assert.match(migration, /bucket_id = 'product-images'/);
  assert.match(migration, /membership\.role IN \('ADMIN', 'MANAGER'\)/);
  assert.match(migration, /\(storage\.foldername\(storage\.objects\.name\)\)\[1\] = membership\.restaurant_id::text/);
  assert.match(migration, /\(storage\.foldername\(storage\.objects\.name\)\)\[2\] = 'products'/);
  assert.match(migration, /FOR INSERT\s+TO authenticated\s+WITH CHECK/);
  assert.match(migration, /FOR UPDATE\s+TO authenticated[\s\S]*?USING[\s\S]*?WITH CHECK/);
  assert.match(migration, /FOR DELETE\s+TO authenticated\s+USING/);
  assert.doesNotMatch(migration, /TO anon\b/);
});
