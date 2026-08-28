import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

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

  private sessionQuery() {
    return this.db
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
      .$dynamic();
  }

  async findSessionByTokenHash(tokenHash: string): Promise<TableSessionRecord | null> {
    const rows = await this.sessionQuery()
      .where(eq(restaurantTables.qrTokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSessionByTableRef(
    restaurantSlug: string,
    tableNumber: number,
  ): Promise<TableSessionRecord | null> {
    const rows = await this.sessionQuery()
      .where(
        and(
          eq(restaurants.slug, restaurantSlug),
          eq(restaurantTables.tableNumber, tableNumber),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listSessionsForRestaurant(
    restaurantId: string,
  ): Promise<readonly TableSessionRecord[]> {
    return this.sessionQuery()
      .where(eq(restaurantTables.restaurantId, restaurantId))
      .orderBy(asc(restaurantTables.tableNumber));
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
          tableNumber: input.tableNumber,
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
        oldValue: {
          name: current.name,
          tableNumber: current.tableNumber,
          seats: current.seats,
          isActive: current.isActive,
        },
        newValue: {
          name: table.name,
          tableNumber: table.tableNumber,
          seats: table.seats,
          isActive: table.isActive,
        },
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

  async pauseQrAccessWithAudit(
    input: ChangeTableTokenRecordInput,
  ): Promise<ManagedTableRecord | null> {
    return this.changeQrAccessWithAudit(input, true);
  }

  async resumeQrAccessWithAudit(
    input: ChangeTableTokenRecordInput,
  ): Promise<ManagedTableRecord | null> {
    return this.changeQrAccessWithAudit(input, false);
  }

  /**
   * Pausing is an access flag, not credential revocation. The hash and version
   * are deliberately absent from this update, so the same printed QR works
   * again after resume. Repeating the current state is a read-only success and
   * does not manufacture duplicate audit rows.
   */
  private changeQrAccessWithAudit(
    input: ChangeTableTokenRecordInput,
    paused: boolean,
  ): Promise<ManagedTableRecord | null> {
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

      const isPaused = current.qrTokenRevokedAt !== null;
      if (isPaused === paused) return current;

      const changedAt = new Date();
      const [table] = await transaction
        .update(restaurantTables)
        .set({
          qrTokenRevokedAt: paused ? changedAt : null,
          updatedAt: changedAt,
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
        action: paused ? "TABLE_QR_PAUSED" : "TABLE_QR_RESUMED",
        entityType: "TABLE",
        entityId: table.id,
        oldValue: { paused: isPaused },
        newValue: { paused },
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
