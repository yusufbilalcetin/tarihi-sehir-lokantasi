import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { attendanceRecords, auditLogs } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";

export class AttendanceService {
  constructor(private readonly db: Database) {}

  async current(restaurantId: string, staffId: string) {
    const [record] = await this.db.select({ id: attendanceRecords.id, businessDate: attendanceRecords.businessDate, clockInAt: attendanceRecords.clockInAt, clockOutAt: attendanceRecords.clockOutAt, breakMinutes: attendanceRecords.breakMinutes, status: attendanceRecords.status }).from(attendanceRecords).where(and(eq(attendanceRecords.restaurantId, restaurantId), eq(attendanceRecords.staffId, staffId), eq(attendanceRecords.status, "OPEN"))).limit(1);
    return record ?? null;
  }

  clockIn(input: { restaurantId: string; staffId: string; requestId: string; businessDate: string }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${input.staffId}:attendance`}, 0))`);
      const [existing] = await tx.select({ id: attendanceRecords.id, clockInAt: attendanceRecords.clockInAt, status: attendanceRecords.status }).from(attendanceRecords).where(and(eq(attendanceRecords.restaurantId, input.restaurantId), eq(attendanceRecords.staffId, input.staffId), eq(attendanceRecords.status, "OPEN"))).limit(1);
      if (existing) return { ...existing, replayed: true };
      const [created] = await tx.insert(attendanceRecords).values({ restaurantId: input.restaurantId, staffId: input.staffId, businessDate: input.businessDate, clockInAt: new Date() }).returning({ id: attendanceRecords.id, clockInAt: attendanceRecords.clockInAt, status: attendanceRecords.status });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.staffId, action: "erp.attendance.clock_in", entityType: "attendance_record", entityId: created.id, newValue: { businessDate: input.businessDate }, requestId: input.requestId });
      return { ...created, replayed: false };
    });
  }

  clockOut(input: { restaurantId: string; staffId: string; requestId: string }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${input.staffId}:attendance`}, 0))`);
      const [record] = await tx.select({ id: attendanceRecords.id, clockInAt: attendanceRecords.clockInAt }).from(attendanceRecords).where(and(eq(attendanceRecords.restaurantId, input.restaurantId), eq(attendanceRecords.staffId, input.staffId), eq(attendanceRecords.status, "OPEN"))).for("update").limit(1);
      if (!record) throw new DomainError("CONFLICT", "Açık puantaj kaydı bulunamadı.", { httpStatus: 409 });
      const at = new Date();
      const [updated] = await tx.update(attendanceRecords).set({ clockOutAt: at, status: "COMPLETED", updatedAt: at }).where(and(eq(attendanceRecords.restaurantId, input.restaurantId), eq(attendanceRecords.id, record.id), eq(attendanceRecords.status, "OPEN"))).returning({ id: attendanceRecords.id, clockInAt: attendanceRecords.clockInAt, clockOutAt: attendanceRecords.clockOutAt, status: attendanceRecords.status });
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.staffId, action: "erp.attendance.clock_out", entityType: "attendance_record", entityId: record.id, newValue: { clockOutAt: at.toISOString() }, requestId: input.requestId });
      return updated;
    });
  }
}
