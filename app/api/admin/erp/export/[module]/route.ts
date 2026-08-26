import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { ADMIN_NO_STORE_HEADERS, adminRead, parseParams } from "@/lib/api/admin-route";
import { DomainError } from "@/lib/api/domain-error";
import { ERP_CSV_EXPORTS, erpCsvFilename, erpRowsToCsv } from "@/lib/domain/erp-csv";
import { ERP_EXPORT_MAX_ROWS } from "@/lib/domain/erp-workspaces";
import { DrizzleErpWorkspaceRepository } from "@/lib/repositories/drizzle-erp-workspace-repository";
import { ErpWorkspaceService } from "@/lib/services/erp-workspace-service";
import { erpWorkspaceModuleSchema, erpWorkspaceQuerySchema } from "@/lib/validation/erp-workspace";

export const runtime = "nodejs";

/**
 * CSV for one ERP report.
 *
 * The tenant is the authenticated principal's, never a query parameter, and the
 * columns come from the module's export DTO rather than from the row — a module
 * with no DTO has no export at all. The rows are read through the same bounded,
 * date-clamped repository the screen uses, so an export can never scan more
 * history than the report it came from.
 */
export async function GET(request: Request, context: { params: Promise<{ module: string }> }): Promise<NextResponse> {
  return adminRead("api.admin.erp.workspace.export", async ({ principal }) => {
    const { module: rawModule } = await context.params;
    const erpModule = parseParams(rawModule, erpWorkspaceModuleSchema, "ERP modülü geçersiz.");
    const definition = ERP_CSV_EXPORTS[erpModule];
    if (!definition) {
      throw new DomainError("NOT_FOUND", "Bu modül için CSV dışa aktarımı tanımlı değil.", { httpStatus: 404 });
    }

    const url = new URL(request.url);
    const query = parseParams(Object.fromEntries(url.searchParams), erpWorkspaceQuerySchema, "ERP filtreleri geçersiz.");
    const data = await new ErpWorkspaceService(new DrizzleErpWorkspaceRepository(getDb())).read(
      principal.restaurantId,
      erpModule,
      { ...query, page: 1, pageSize: ERP_EXPORT_MAX_ROWS },
    );

    // The filename names the window the report actually used, which is the
    // clamped one — not the possibly-wider one that was asked for.
    const asDay = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
    return new NextResponse(erpRowsToCsv(definition.columns, data.rows), {
      status: 200,
      headers: {
        ...ADMIN_NO_STORE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${erpCsvFilename(definition.slug, asDay(data.summary.dateFrom), asDay(data.summary.dateTo))}"`,
      },
    });
  });
}
