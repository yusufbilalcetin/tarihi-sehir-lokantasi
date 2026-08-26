import { z } from "zod";
import { getDb } from "@/db";
import { parseBody } from "@/lib/api/admin-route";
import { staffMutation, staffRead } from "@/lib/api/staff-route";
import { AttendanceService } from "@/lib/services/attendance-service";

const ALL_STAFF_ROLES = ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "CASHIER"] as const;
const commandSchema = z.object({ action: z.enum(["CLOCK_IN", "CLOCK_OUT"]) }).strict();

function service() { return new AttendanceService(getDb()); }

export async function GET() {
  return staffRead(ALL_STAFF_ROLES, "api.staff.attendance.read", ({ principal }) => service().current(principal.restaurantId, principal.user.id));
}

export async function POST(request: Request) {
  return staffMutation(request, ALL_STAFF_ROLES, "api.staff.attendance.mutate", async ({ principal, requestId }) => {
    const body = await parseBody(request, commandSchema, "Puantaj işlemi geçersiz.");
    if (body.action === "CLOCK_OUT") return service().clockOut({ restaurantId: principal.restaurantId, staffId: principal.user.id, requestId });
    const timezone = "Europe/Istanbul";
    const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return service().clockIn({ restaurantId: principal.restaurantId, staffId: principal.user.id, requestId, businessDate });
  });
}
