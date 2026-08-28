import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  ChangeTableTokenRecordInput,
  CreateManagedTableRecordInput,
  ManagedTableRecord,
  TableRepository,
  TableSessionRecord,
  UpdateManagedTableRecordInput,
} from "../../lib/repositories/table-repository";
import { TableService, type TableTokenCodec } from "../../lib/services/table-service";

const admin: RestaurantPrincipal = {
  userId: "user-1",
  restaurantId: "restaurant-1",
  role: "ADMIN",
  isActive: true,
};

class FakeTableRepository implements TableRepository {
  session: TableSessionRecord | null = {
    id: "table-1",
    restaurantId: "restaurant-1",
    name: "Masa 3",
    tableNumber: 3,
    seats: 4,
    qrTokenHash: "hash:valid-token",
    qrTokenVersion: 4,
    qrTokenRevokedAt: null,
    tableIsActive: true,
    restaurantName: "Tarihi Sehir Lokantasi",
    restaurantSlug: "tarihi-sehir-lokantasi",
    restaurantIsActive: true,
    currency: "TRY",
    timezone: "Europe/Istanbul",
  };
  managed: ManagedTableRecord = {
    id: "table-1",
    restaurantId: "restaurant-1",
    name: "Masa 3",
    tableNumber: 3,
    seats: 4,
    qrTokenVersion: 4,
    qrTokenRevokedAt: null,
    isActive: true,
  };

  async findSessionByTokenHash(tokenHash: string): Promise<TableSessionRecord | null> {
    return this.session?.qrTokenHash === tokenHash ? this.session : null;
  }
  async findSessionByTableRef(
    restaurantSlug: string,
    tableNumber: number,
  ): Promise<TableSessionRecord | null> {
    return this.session?.restaurantSlug === restaurantSlug &&
      this.session.tableNumber === tableNumber
      ? this.session
      : null;
  }
  async listSessionsForRestaurant(restaurantId: string): Promise<readonly TableSessionRecord[]> {
    return this.session?.restaurantId === restaurantId ? [this.session] : [];
  }
  async createWithAudit(input: CreateManagedTableRecordInput): Promise<ManagedTableRecord> {
    return { ...this.managed, name: input.name, tableNumber: input.tableNumber, seats: input.seats };
  }
  async rotateTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord> {
    assert.equal(input.restaurantId, "restaurant-1");
    this.managed = { ...this.managed, qrTokenVersion: this.managed.qrTokenVersion + 1 };
    return this.managed;
  }
  async revokeTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord> {
    assert.equal(input.restaurantId, "restaurant-1");
    this.managed = {
      ...this.managed,
      qrTokenVersion: this.managed.qrTokenVersion + 1,
      qrTokenRevokedAt: new Date("2026-08-13T12:00:00.000Z"),
    };
    return this.managed;
  }
  async pauseQrAccessWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null> {
    if (input.restaurantId !== this.managed.restaurantId) return null;
    const pausedAt = new Date("2026-08-28T12:00:00.000Z");
    this.managed = { ...this.managed, qrTokenRevokedAt: pausedAt };
    if (this.session) this.session = { ...this.session, qrTokenRevokedAt: pausedAt };
    return this.managed;
  }
  async resumeQrAccessWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null> {
    if (input.restaurantId !== this.managed.restaurantId) return null;
    this.managed = { ...this.managed, qrTokenRevokedAt: null };
    if (this.session) this.session = { ...this.session, qrTokenRevokedAt: null };
    return this.managed;
  }
  async updateWithAudit(input: UpdateManagedTableRecordInput): Promise<ManagedTableRecord | null> {
    if (input.restaurantId !== this.managed.restaurantId) return null;
    this.managed = {
      ...this.managed,
      name: input.name ?? this.managed.name,
      tableNumber: input.tableNumber ?? this.managed.tableNumber,
      seats: input.seats ?? this.managed.seats,
      isActive: input.isActive ?? this.managed.isActive,
    };
    return this.managed;
  }
}

function codec(): TableTokenCodec {
  let issued = 0;
  return {
    generate() {
      issued += 1;
      return { rawToken: `raw-token-${issued}`, tokenHash: `generated-hash-${issued}` };
    },
    hash(rawToken) {
      if (!rawToken) throw new Error("bad token");
      return `hash:${rawToken}`;
    },
    verify(rawToken, storedHash) {
      return typeof rawToken === "string" && storedHash === `hash:${rawToken}`;
    },
    deriveLink(claims) {
      return `l1.${claims.restaurantSlug}.${claims.tableNumber}.v${claims.accessVersion}`;
    },
    verifyLink(candidate, claims) {
      return candidate === this.deriveLink(claims);
    },
  };
}

test("TableService validates active table and exposes no token hash", async () => {
  const result = await new TableService(new FakeTableRepository(), codec()).validateToken("valid-token");
  assert.equal(result.table.accessVersion, 4);
  assert.equal(result.table.tableNumber, 3);
  assert.equal("qrTokenHash" in result.table, false);
});

test("TableService rejects invalid and inactive table tokens", async () => {
  const repository = new FakeTableRepository();
  const service = new TableService(repository, codec());
  await assert.rejects(
    () => service.validateToken("missing-token"),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TABLE_TOKEN",
  );

  repository.session = { ...repository.session!, tableIsActive: false };
  await assert.rejects(
    () => service.validateToken("valid-token"),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_INACTIVE",
  );
});

test("TableService returns each generated raw token once and increments revoke version", async () => {
  const repository = new FakeTableRepository();
  const service = new TableService(repository, codec());
  const rotated = await service.rotateToken(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  const revoked = await service.revokeToken(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  assert.equal(rotated.rawToken, "raw-token-1");
  assert.equal("rawToken" in revoked, false);
  assert.equal(revoked.accessVersion, 6);
});

test("TableService fails closed for wrong restaurant scope", async () => {
  const service = new TableService(new FakeTableRepository(), codec());
  await assert.rejects(
    () => service.rotateToken(admin, { restaurantId: "restaurant-2", tableId: "table-1" }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "RESTAURANT_SCOPE_VIOLATION",
  );
});

test("TableService rejects a blank rename and scopes updates to the restaurant", async () => {
  const repository = new FakeTableRepository();
  const service = new TableService(repository, codec());

  await assert.rejects(
    () => service.updateTable(admin, {
      restaurantId: "restaurant-1",
      tableId: "table-1",
      name: "   ",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );

  const updated = await service.updateTable(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
    name: "  Bahçe 2  ",
    tableNumber: 7,
    isActive: false,
  });
  assert.equal(updated.name, "Bahçe 2");
  assert.equal(updated.tableNumber, 7);
  assert.equal(updated.isActive, false);

  await assert.rejects(
    () => service.updateTable(
      { ...admin, restaurantId: "restaurant-2" },
      { restaurantId: "restaurant-2", tableId: "table-1", seats: 6 },
    ),
    (error: unknown) => error instanceof DomainError,
  );
});
