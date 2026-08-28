import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pause and resume update only the reversible access flag", async () => {
  const source = await readFile("lib/repositories/drizzle-table-repository.ts", "utf8");
  const accessMethod = source.slice(
    source.indexOf("private changeQrAccessWithAudit"),
    source.indexOf("async revokeTokenWithAudit"),
  );
  assert.match(accessMethod, /qrTokenRevokedAt: paused \? changedAt : null/);
  assert.doesNotMatch(accessMethod, /qrTokenVersion/);
  assert.doesNotMatch(accessMethod, /qrTokenHash/);
  assert.match(accessMethod, /isPaused === paused/);
  assert.match(accessMethod, /TABLE_QR_PAUSED/);
  assert.match(accessMethod, /TABLE_QR_RESUMED/);
});

test("rotation advances the credential without changing paused state", async () => {
  const source = await readFile("lib/repositories/drizzle-table-repository.ts", "utf8");
  const rotation = source.slice(
    source.indexOf("async rotateTokenWithAudit"),
    source.indexOf("async pauseQrAccessWithAudit"),
  );
  assert.match(rotation, /qrTokenHash: input\.qrTokenHash/);
  assert.match(rotation, /qrTokenVersion: sql`\$\{restaurantTables\.qrTokenVersion\} \+ 1`/);
  assert.doesNotMatch(rotation, /qrTokenRevokedAt/);
  assert.doesNotMatch(source, /qrTokenVersion[^\n]*-\s*1/);
});

test("pause and resume routes trust only the authenticated tenant", async () => {
  for (const action of ["pause", "resume"]) {
    const source = await readFile(
      `app/api/admin/tables/[tableId]/qr/${action}/route.ts`,
      "utf8",
    );
    assert.match(source, /adminMutation\(/);
    assert.match(source, /restaurantId: principal\.restaurantId/);
    assert.doesNotMatch(source, /request\.json/);
  }
});

test("active and paused cards expose the correct reversible state action", async () => {
  const [toggle, manager, detail] = await Promise.all([
    readFile("components/admin/qr-access-toggle.tsx", "utf8"),
    readFile("components/admin/qr-manager.tsx", "utf8"),
    readFile("components/admin/table-detail-sheet.tsx", "utf8"),
  ]);
  assert.match(toggle, /paused \? "Etkinleştir" : "Durdur"/);
  assert.match(toggle, /\{!paused \? <Dialog/);
  assert.match(toggle, /adminApi\.pauseTableQr/);
  assert.match(toggle, /adminApi\.resumeTableQr/);
  assert.match(toggle, /QR Menüyü Durdur/);
  assert.match(toggle, /aynı kodla tekrar etkinleştirilebilir/);
  assert.match(manager, /activeQrCount = qrCodes\.codes\.filter\(\(code\) => !code\.revoked\)\.length/);
  assert.match(manager, /active = !code\.revoked/);
  assert.match(manager, /paused\n\s+onChanged=\{refreshAll\}/);
  assert.match(detail, /paused=\{qr\.revoked\}/);
  assert.doesNotMatch(`${manager}\n${detail}\n${toggle}`, /revokeTableToken/);
});

test("table plan QR readiness is independent from table service state", async () => {
  const [adapter, manager] = await Promise.all([
    readFile("lib/adapters/staff-view-model.ts", "utf8"),
    readFile("components/admin/tables-manager.tsx", "utf8"),
  ]);
  assert.match(adapter, /qrAvailable: !table\.qrRevoked/);
  assert.match(manager, /qrReady = Boolean\(qr && !qr\.revoked\)/);
  assert.doesNotMatch(manager, /qrReady = Boolean\(qr\?\.isActive/);
});
