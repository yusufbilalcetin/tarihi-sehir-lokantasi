import assert from "node:assert/strict";
import test from "node:test";

import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import {
  QR_ERROR_CORRECTION_LEVEL,
  QR_QUIET_ZONE_MODULES,
  buildQrMatrix,
  logoCoverageRatio,
  logoModuleSpan,
} from "../../lib/qr/qr-matrix";
import type {
  ChangeTableTokenRecordInput,
  ManagedTableRecord,
  TableRepository,
  TableSessionRecord,
} from "../../lib/repositories/table-repository";
import {
  deriveQrLinkToken,
  parseQrLinkToken,
  verifyQrLinkToken,
} from "../../lib/security/qr-link-token";
import { TableService, type TableTokenCodec } from "../../lib/services/table-service";

const pepper = "p".repeat(48);
const otherPepper = "q".repeat(48);
const claims = { restaurantSlug: "tarihi-sehir-lokantasi", tableNumber: 4, accessVersion: 7 };

const admin: RestaurantPrincipal = {
  userId: "user-1",
  restaurantId: "restaurant-1",
  role: "ADMIN",
  isActive: true,
};

test("the QR link is derived, stable and bound to the access version", () => {
  const token = deriveQrLinkToken(claims, pepper);
  assert.equal(token, deriveQrLinkToken(claims, pepper));
  assert.equal(verifyQrLinkToken(token, claims, pepper), true);

  // Rotation and revocation both bump the version; the printed card dies with it.
  assert.equal(verifyQrLinkToken(token, { ...claims, accessVersion: 8 }, pepper), false);
  assert.equal(verifyQrLinkToken(token, claims, otherPepper), false);
  assert.equal(verifyQrLinkToken(token, { ...claims, tableNumber: 5 }, pepper), false);
});

test("a QR link carries no database identifier and rejects tampering", () => {
  const token = deriveQrLinkToken(claims, pepper);
  const parsed = parseQrLinkToken(token);
  assert.ok(parsed);
  assert.equal(parsed.restaurantSlug, claims.restaurantSlug);
  assert.equal(parsed.tableNumber, 4);
  assert.doesNotMatch(token, /[0-9a-f]{8}-[0-9a-f]{4}-/i);

  const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifyQrLinkToken(flipped, claims, pepper), false);
  for (const malformed of [
    "",
    "l1.slug.4",
    `l2.${claims.restaurantSlug}.4.${"A".repeat(43)}`,
    `l1.${claims.restaurantSlug}.0.${"A".repeat(43)}`,
    `l1.Slug.4.${"A".repeat(43)}`,
    "A".repeat(43),
  ]) {
    assert.equal(parseQrLinkToken(malformed), null, malformed);
  }
});

class QrFakeRepository implements TableRepository {
  rotations = 0;
  session: TableSessionRecord = {
    id: "table-1",
    restaurantId: "restaurant-1",
    name: "Masa 4",
    tableNumber: 4,
    seats: 4,
    qrTokenHash: "v1.unused",
    qrTokenVersion: 7,
    qrTokenRevokedAt: null,
    tableIsActive: true,
    restaurantName: "Tarihi Sehir Lokantasi",
    restaurantSlug: "tarihi-sehir-lokantasi",
    restaurantIsActive: true,
    currency: "TRY",
    timezone: "Europe/Istanbul",
  };

  async findSessionByTokenHash(tokenHash: string) {
    return this.session.qrTokenHash === tokenHash ? this.session : null;
  }
  async findSessionByTableRef(restaurantSlug: string, tableNumber: number) {
    return this.session.restaurantSlug === restaurantSlug &&
      this.session.tableNumber === tableNumber
      ? this.session
      : null;
  }
  async listSessionsForRestaurant(restaurantId: string) {
    return this.session.restaurantId === restaurantId ? [this.session] : [];
  }
  async rotateTokenWithAudit(
    input: ChangeTableTokenRecordInput,
  ): Promise<ManagedTableRecord> {
    this.rotations += 1;
    this.session = {
      ...this.session,
      qrTokenVersion: this.session.qrTokenVersion + 1,
      qrTokenHash: input.qrTokenHash ?? this.session.qrTokenHash,
    };
    return {
      id: this.session.id,
      restaurantId: this.session.restaurantId,
      name: this.session.name,
      tableNumber: this.session.tableNumber,
      seats: this.session.seats,
      qrTokenVersion: this.session.qrTokenVersion,
      qrTokenRevokedAt: this.session.qrTokenRevokedAt,
      isActive: true,
    };
  }
  async pauseQrAccessWithAudit(
    input: ChangeTableTokenRecordInput,
  ): Promise<ManagedTableRecord | null> {
    if (input.restaurantId !== this.session.restaurantId || input.tableId !== this.session.id) return null;
    this.session = { ...this.session, qrTokenRevokedAt: new Date("2026-08-28T12:00:00.000Z") };
    return this.managedResult();
  }
  async resumeQrAccessWithAudit(
    input: ChangeTableTokenRecordInput,
  ): Promise<ManagedTableRecord | null> {
    if (input.restaurantId !== this.session.restaurantId || input.tableId !== this.session.id) return null;
    this.session = { ...this.session, qrTokenRevokedAt: null };
    return this.managedResult();
  }
  private managedResult(): ManagedTableRecord {
    return {
      id: this.session.id,
      restaurantId: this.session.restaurantId,
      name: this.session.name,
      tableNumber: this.session.tableNumber,
      seats: this.session.seats,
      qrTokenVersion: this.session.qrTokenVersion,
      qrTokenRevokedAt: this.session.qrTokenRevokedAt,
      isActive: this.session.tableIsActive,
    };
  }
  async createWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
  async revokeTokenWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
  async updateWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
}

function realCodec(): TableTokenCodec {
  return {
    generate: () => ({ rawToken: "r".repeat(43), tokenHash: "v1.rotated" }),
    hash: (rawToken) => `v1.${rawToken}`,
    verify: () => false,
    deriveLink: (linkClaims) => deriveQrLinkToken(linkClaims, pepper),
    verifyLink: (candidate, linkClaims) => verifyQrLinkToken(candidate, linkClaims, pepper),
  };
}

test("listing, previewing and reprinting a QR never rotates it", async () => {
  const repository = new QrFakeRepository();
  const service = new TableService(repository, realCodec());

  const first = await service.listQrLinks(admin, "restaurant-1");
  const second = await service.listQrLinks(admin, "restaurant-1");

  assert.equal(repository.rotations, 0);
  assert.equal(repository.session.qrTokenVersion, 7);
  assert.deepEqual(first.links, second.links);
  assert.equal(first.restaurantName, "Tarihi Sehir Lokantasi");
  assert.match(first.links[0].menuPath, /^\/menu\/l1\.tarihi-sehir-lokantasi\.4\./);

  // And the address it hands out actually opens the right table.
  const token = first.links[0].menuPath.slice("/menu/".length);
  const validated = await service.validateToken(token);
  assert.equal(validated.table.name, "Masa 4");
  assert.equal(validated.restaurant.slug, "tarihi-sehir-lokantasi");
  assert.equal(repository.rotations, 0);
});

test("an explicit renewal rotates exactly once and voids the previous QR", async () => {
  const repository = new QrFakeRepository();
  const service = new TableService(repository, realCodec());
  const before = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;

  await service.rotateToken(admin, { restaurantId: "restaurant-1", tableId: "table-1" });
  assert.equal(repository.rotations, 1);

  const after = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  assert.notEqual(before, after);
  await assert.rejects(() => service.validateToken(before.slice("/menu/".length)));
  const validated = await service.validateToken(after.slice("/menu/".length));
  assert.equal(validated.table.accessVersion, 8);
});

test("pause and resume preserve the credential, version and exact QR address", async () => {
  const repository = new QrFakeRepository();
  const service = new TableService(repository, realCodec());
  const before = (await service.listQrLinks(admin, "restaurant-1")).links[0];
  const beforeHash = repository.session.qrTokenHash;
  const beforeVersion = repository.session.qrTokenVersion;

  const paused = await service.pauseQrAccess(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  assert.equal(paused.accessVersion, beforeVersion);
  assert.equal(repository.session.qrTokenHash, beforeHash);
  assert.equal("rawToken" in paused, false);
  await assert.rejects(() => service.validateToken(before.menuPath.slice("/menu/".length)));

  const resumed = await service.resumeQrAccess(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  const after = (await service.listQrLinks(admin, "restaurant-1")).links[0];
  assert.equal(resumed.accessVersion, beforeVersion);
  assert.equal(repository.session.qrTokenHash, beforeHash);
  assert.equal(before.menuPath, after.menuPath);
  assert.equal("rawToken" in resumed, false);
  assert.equal((await service.validateToken(after.menuPath.slice("/menu/".length))).table.id, "table-1");
});

test("rotating a paused QR changes the credential once but does not resume access", async () => {
  const repository = new QrFakeRepository();
  const service = new TableService(repository, realCodec());
  const before = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  await service.pauseQrAccess(admin, { restaurantId: "restaurant-1", tableId: "table-1" });

  await service.rotateToken(admin, { restaurantId: "restaurant-1", tableId: "table-1" });
  const after = (await service.listQrLinks(admin, "restaurant-1")).links[0];
  assert.equal(repository.session.qrTokenVersion, 8);
  assert.equal(repository.rotations, 1);
  assert.notEqual(before, after.menuPath);
  assert.equal(after.revoked, true);
  await assert.rejects(() => service.validateToken(after.menuPath.slice("/menu/".length)));
});

test("cross-tenant resume is rejected before the repository can expose a table", async () => {
  const service = new TableService(new QrFakeRepository(), realCodec());
  await assert.rejects(
    () => service.resumeQrAccess(admin, { restaurantId: "restaurant-2", tableId: "table-1" }),
    (error: unknown) => error instanceof Error && error.name === "DomainError",
  );
});

test("listing QR links requires a table manager of that restaurant", async () => {
  const service = new TableService(new QrFakeRepository(), realCodec());
  await assert.rejects(() => service.listQrLinks(null, "restaurant-1"));
  await assert.rejects(() => service.listQrLinks({ ...admin, role: "WAITER" }, "restaurant-1"));
  await assert.rejects(() => service.listQrLinks(admin, "restaurant-2"));
});

test("a revoked or inactive table refuses its QR link", async () => {
  const repository = new QrFakeRepository();
  const service = new TableService(repository, realCodec());
  const path = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  repository.session = { ...repository.session, qrTokenRevokedAt: new Date() };
  await assert.rejects(() => service.validateToken(path.slice("/menu/".length)));
});

test("the branded code keeps the highest correction level and a legal quiet zone", () => {
  const menuUrl = `https://tarihi-sehir-lokantasi.vercel.app/menu/${deriveQrLinkToken(claims, pepper)}`;
  const matrix = buildQrMatrix(menuUrl);

  assert.equal(QR_ERROR_CORRECTION_LEVEL, "H");
  assert.ok(QR_QUIET_ZONE_MODULES >= 4);
  assert.equal(matrix.canvasModules, matrix.moduleCount + QR_QUIET_ZONE_MODULES * 2);
  assert.equal(matrix.modules.length, matrix.moduleCount);

  // The brand mark stays a small, odd-width island well inside level H's budget.
  const span = logoModuleSpan(matrix.moduleCount);
  assert.equal(span % 2, 1);
  assert.ok(logoCoverageRatio(matrix.moduleCount) < 0.05);
  assert.ok(span / matrix.moduleCount <= 0.18);
});

test("one address encodes to one matrix, whatever size it is drawn at", () => {
  const menuUrl = `https://tarihi-sehir-lokantasi.vercel.app/menu/${deriveQrLinkToken(claims, pepper)}`;
  // Rendering scales the same matrix; 256, 512 and 1024 px differ only in the
  // pixels per module, which is why every size scans to the same address.
  const reference = buildQrMatrix(menuUrl);
  for (const size of [256, 512, 1024]) {
    const matrix = buildQrMatrix(menuUrl);
    assert.deepEqual(matrix.modules, reference.modules);
    assert.ok(Math.floor(size / matrix.canvasModules) >= 1, `${size}px fits a module`);
  }
  assert.notDeepEqual(buildQrMatrix(`${menuUrl}x`).modules, reference.modules);
});

test("a printed QR points at the configured origin, never at a preview host", async () => {
  const { resolveAppBaseUrl } = await import("../../lib/config/app-base-url");
  const request = new Request("http://localhost:3000/api/admin/tables/qr-codes");

  // Configuration wins, because a card outlives the deployment that printed it.
  assert.equal(
    resolveAppBaseUrl(request, { APP_BASE_URL: "https://tarihi-sehir-lokantasi.vercel.app/" }),
    "https://tarihi-sehir-lokantasi.vercel.app",
  );
  assert.equal(
    resolveAppBaseUrl(request, {
      VERCEL_PROJECT_PRODUCTION_URL: "tarihi-sehir-lokantasi.vercel.app",
      VERCEL_URL: "sehir-lokantasi-git-branch.vercel.app",
    }),
    "https://tarihi-sehir-lokantasi.vercel.app",
  );
  // Only with neither configured does it fall back to the request, which is
  // what serves local development.
  assert.equal(resolveAppBaseUrl(request, {}), "http://localhost:3000");
  assert.equal(resolveAppBaseUrl(undefined, {}), "http://localhost:3000");
  // Junk in configuration must not silently become the printed origin.
  assert.equal(
    resolveAppBaseUrl(request, { APP_BASE_URL: "javascript:alert(1)" }),
    "http://localhost:3000",
  );
});
