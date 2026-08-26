import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = reportRoute("tables", async ({ principal, range, service }) => ({
  tables: await service.getTables(principal, range),
}));
