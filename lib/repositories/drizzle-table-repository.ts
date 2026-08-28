import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { auditLogs, restaurants, restaurantTables } from "../../db/schema";
import type {
  ChangeTableTokenRecordInput,
  CreateManagedTableRecordInput,
  ManagedTableRecord,
  TableRepository,
  TableSessionRecord,
  UpdateManagedTableRecordInput,
} from "./table-repository";

const tableSelection = {
  id: restaurantTables.id,
  restaurantId: restaurantTables.restaurantId,
  name: restaurantTables.name,
  tableNumber: restaurantTables.tableNumber,
  seats: restaurantTables.seats,
  qrTokenVersion: restaurantTables.qrTokenVersion,
  qrTokenRevokedAt: restaurantTables.qrTokenRevokedAt,
  isActive: restaurantTables.isActive,
} as const;

export class DrizzleTableRepository implements TableRepository {
  constructor(private readonly db: Database) {}

  async findSessionByTokenHash(tokenHash: string): Promise<TableSessionRecord | null> {
    const rows = await this.db
      .select({
        id: restaurantTables.id,
        restaurantId: restaurantTables.restaurantId,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        seats: restaurantTables.seats,
        qrTokenHash: restaurantTables.qrTokenHash,
        qrTokenVersion: restaurantTables.qrTokenVersion,
        qrTokenRevokedAt: restaurantTables.qrTokenRevokedAt,
        tableIsActive: restaurantTables.isActive,
        restaurantName: restaurants.name,
        restaurantSlug: restaurants.slug,
        restaurantIsActive: restaurants.isActive,
        currency: restaurants.currency,
        timezone: restaurants.timezone,
      })
      .from(restaurantTables)
      .innerJoin(restaurants, eq(restaurants.id, restaurantTables.restaurantId))
      .where(eq(restaurantTables.qrTokenHash, tokenHash))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateWithAudit(input: UpdateManagedTableRecordInput): Promise<ManagedTableRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select(tableSelection)
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.restaurantId, input.restaurantId),
            eq(restaurantTables.id, input.tableId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return null;

      const changes = Object.fromEntries(
        Object.entries({
          name: input.name,
          seats: input.seats,
          isActive: input.isActive,
        }).filter(([, value]) => value !== undefined),
      );
      const [table] = await transaction
        .update(restaurantTables)
        .set({
          ...changes,
          // A deactivated table must also stop showing a stale floor status.
          ...(input.isActive === false ? { currentStatus: "INACTIVE" as const } : {}),
          ...(input.isActive === true && current.isActive === false
            ? { currentStatus: "AVAILABLE" as const }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(restaurantTables.restaurantId, input.restaurantId),
            eq(restaurantTables.id, input.tableId),
          ),
        )
        .returning(tableSelection);
      if (!table) return null;

      await transaction.insert(auditLogs).values({
        restaurantId: input.restaurantId,
        actorUserId: input.actorUserId,
        action: "TABLE_UPDATED",
        entityType: "TABLE",
        entityId: table.id,
        oldValue: { name: current.name, seats: current.seats, isActive: current.isActive },
        newValue: { name: table.name, seats: table.seats, isActive: table.isActive },
        requestId: input.audit?.requestId,
        ipAddress: input.audit?.ipAddress,
        userAgent: input.audit?.userAgent,
      });
      return table;
    });
  }

  async createWithAudit(input: CreateManagedTableRecordInput): Promise<ManagedTableRecord | null> {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .insert(restaurantTables)
        .values({
          restaurantId: input.restaurantId,
          name: input.name,
          tableNumber: input.tableNumber,
          seats: input.seats,
          qrTokenHash: input.qrTokenHash,
        })
        .returning(tableSelection);
      const table = rows[0];
      if (!table) return null;

      await transaction.insert(auditLogs).values({
        restaurantId: input.restaurantId,
        actorUserId: input.actorUserId,
        action: "TABLE_CREATED",
        entityType: "TABLE",
        entityId: table.id,
        newValue: {
          name: table.name,
          tableNumber: table.tableNumber,
          seats: table.seats,
          qrTokenVersion: table.qrTokenVersion,
        },
        requestId: input.audit?.requestId,
        ipAddress: input.audit?.ipAddress,
        userAgent: input.audit?.userAgent,
      });
      return table;
    });
  }

  async rotateTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null> {
    if (!input.qrTokenHash) throw new TypeError("Rotating a table token requires its hash.");
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .update(restaurantTables)
        .set({
          qrTokenHash: input.qrTokenHash,
          qrTokenVersion: sql`${restaurantTables.qrTokenVersion} + 1`,
          qrTokenRotatedAt: new Date(),
          qrTokenRevokedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(restaurantTables.restaurantId, input.restaurantId),
            eq(restaurantTables.id, input.tableId),
          ),
        )
        .returning(tableSelection);
      const table = rows[0];
      if (!table) return null;

      await transaction.insert(auditLogs).values({
        restaurantId: input.restaurantId,
        actorUserId: input.actorUserId,
        action: "TABLE_QR_ROTATED",
        entityType: "TABLE",
        entityId: table.id,
        newValue: { qrTokenVersion: table.qrTokenVersion },
        requestId: input.audit?.requestId,
        ipAddress: input.audit?.ipAddress,
        userAgent: input.audit?.userAgent,
      });
      return table;
    });
  }

  async revokeTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null> {
    const revokedAt = new Date();
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .update(restaurantTables)
        .set({
          qrTokenVersion: sql`${restaurantTables.qrTokenVersion} + 1`,
          qrTokenRevokedAt: revokedAt,
          updatedAt: revokedAt,
        })
        .where(
          and(
            eq(restaurantTables.restaurantId, input.restaurantId),
            eq(restaurantTables.id, input.tableId),
          ),
        )
        .returning(tableSelection);
      const table = rows[0];
      if (!table) return null;

      await transaction.insert(auditLogs).values({
        restaurantId: input.restaurantId,
        actorUserId: input.actorUserId,
        action: "TABLE_QR_REVOKED",
        entityType: "TABLE",
        entityId: table.id,
        newValue: { qrTokenVersion: table.qrTokenVersion, revoked: true },
        requestId: input.audit?.requestId,
        ipAddress: input.audit?.ipAddress,
        userAgent: input.audit?.userAgent,
      });
      return table;
    });
  }
}
