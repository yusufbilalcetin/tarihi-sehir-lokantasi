import { and, asc, eq, gt, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { staffSchedules } from "@/db/schema";
import { staffRead } from "@/lib/api/staff-route";

const ALL_STAFF_ROLES = ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "CASHIER"] as const;

export async function GET() {
  return staffRead(ALL_STAFF_ROLES, "api.staff.schedule.read", async ({ principal }) => {
    return getDb().select({ id: staffSchedules.id, startsAt: staffSchedules.startsAt, endsAt: staffSchedules.endsAt, roleLabel: staffSchedules.roleLabel, locationLabel: staffSchedules.locationLabel, notes: staffSchedules.notes, status: staffSchedules.status })
      .from(staffSchedules)
      .where(and(eq(staffSchedules.restaurantId, principal.restaurantId), eq(staffSchedules.staffId, principal.user.id), gt(staffSchedules.endsAt, new Date()), inArray(staffSchedules.status, ["PLANNED", "CONFIRMED"])))
      .orderBy(asc(staffSchedules.startsAt)).limit(14);
  });
}
