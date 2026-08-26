import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = reportRoute("staff", async ({ principal, range, service }) => ({
  staff: await service.getStaff(principal, range),
}));
