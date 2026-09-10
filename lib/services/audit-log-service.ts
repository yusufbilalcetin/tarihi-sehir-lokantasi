import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { auditLogs, staffProfiles } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import {
  auditActionLabel,
  auditEntityLabel,
  projectAuditChanges,
  type AuditLogPage,
  type AuditLogQuery,
} from "@/lib/domain/audit-log";
import {
  DEFAULT_RESTAURANT_TIME_ZONE,
  addDays,
  parseDay,
  startOfLocalDay,
} from "@/lib/domain/report-range";

/**
 * The restaurant's own record of what its people did.
 *
 * Read-only, and only ever read-only: every write already happens inside the
 * transaction that made the change, so this service has no update, no delete
 * and no way to reach one. It exists so a manager can answer "who cancelled
 * that?" without a database client.
 */

export class AuditLogService {
  constructor(private readonly db: Database = getDb()) {}

  async list(principal: StaffPrincipal, query: AuditLogQuery): Promise<AuditLogPage> {
    // Scoped to the signed-in restaurant, always. The tenant is never taken
    // from the request.
    const timeZone = principal.restaurant?.timezone ?? DEFAULT_RESTAURANT_TIME_ZONE;
    const predicates: SQL[] = [eq(auditLogs.restaurantId, principal.restaurantId)];

    if (query.dateFrom) {
      predicates.push(gte(auditLogs.createdAt, startOfLocalDay(parseDay(query.dateFrom), timeZone)));
    }
    if (query.dateTo) {
      predicates.push(
        lt(auditLogs.createdAt, startOfLocalDay(addDays(parseDay(query.dateTo), 1), timeZone)),
      );
    }
    if (query.actorId) predicates.push(eq(auditLogs.actorUserId, query.actorId));
    if (query.action) predicates.push(eq(auditLogs.action, query.action));
    if (query.search) {
      const term = `%${query.search}%`;
      const match = or(
        ilike(auditLogs.action, term),
        ilike(auditLogs.entityType, term),
        ilike(staffProfiles.name, term),
      );
      if (match) predicates.push(match);
    }

    const where = and(...predicates);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: auditLogs.id,
          createdAt: auditLogs.createdAt,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          oldValue: auditLogs.oldValue,
          newValue: auditLogs.newValue,
          requestId: auditLogs.requestId,
          actorName: staffProfiles.name,
          actorRole: staffProfiles.role,
        })
        .from(auditLogs)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, auditLogs.restaurantId),
            eq(staffProfiles.id, auditLogs.actorUserId),
          ),
        )
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(query.pageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, auditLogs.restaurantId),
            eq(staffProfiles.id, auditLogs.actorUserId),
          ),
        )
        .where(where),
    ]);

    const total = Number(counted?.total ?? 0);
    return {
      entries: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        actorName: row.actorName,
        actorRole: row.actorRole,
        action: row.action,
        actionLabel: auditActionLabel(row.action),
        entityType: row.entityType,
        entityLabel: auditEntityLabel(row.entityType),
        entityId: row.entityId,
        changes: projectAuditChanges(row.oldValue, row.newValue),
        requestId: row.requestId,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /** The people who appear in this restaurant's record, for the actor filter. */
  async actors(principal: StaffPrincipal): Promise<readonly { id: string; name: string }[]> {
    const rows = await this.db
      .selectDistinct({ id: staffProfiles.id, name: staffProfiles.name })
      .from(auditLogs)
      .innerJoin(
        staffProfiles,
        and(
          eq(staffProfiles.restaurantId, auditLogs.restaurantId),
          eq(staffProfiles.id, auditLogs.actorUserId),
        ),
      )
      .where(eq(auditLogs.restaurantId, principal.restaurantId))
      .limit(200);
    return rows;
  }
}

/** Never reachable: the record is written where the change is, and only there. */
export function auditIsReadOnly(): true {
  return true;
}

export function notFound(): DomainError {
  return new DomainError("NOT_FOUND", "Kayıt bulunamadı.", { httpStatus: 404 });
}
