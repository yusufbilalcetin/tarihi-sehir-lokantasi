import { getDb } from "@/db";
import { adminMutation, adminRead, parseBody, parseParams } from "@/lib/api/admin-route";
import { DrizzleErpWorkspaceRepository } from "@/lib/repositories/drizzle-erp-workspace-repository";
import { ErpWorkspaceService } from "@/lib/services/erp-workspace-service";
import { erpWorkspaceCommandSchema, erpWorkspaceModuleSchema, erpWorkspaceQuerySchema } from "@/lib/validation/erp-workspace";

function service() {
  return new ErpWorkspaceService(new DrizzleErpWorkspaceRepository(getDb()));
}

export async function GET(request: Request, context: { params: Promise<{ module: string }> }) {
  return adminRead("api.admin.erp.workspace.read", async ({ principal }) => {
    const { module: rawModule } = await context.params;
    const erpModule = parseParams(rawModule, erpWorkspaceModuleSchema, "ERP modülü geçersiz.");
    const url = new URL(request.url);
    const query = parseParams(Object.fromEntries(url.searchParams), erpWorkspaceQuerySchema, "ERP filtreleri geçersiz.");
    return service().read(principal.restaurantId, erpModule, query);
  });
}

export async function POST(request: Request, context: { params: Promise<{ module: string }> }) {
  return adminMutation(request, "api.admin.erp.workspace.mutate", async ({ principal, requestId }) => {
    const { module: rawModule } = await context.params;
    parseParams(rawModule, erpWorkspaceModuleSchema, "ERP modülü geçersiz.");
    const command = await parseBody(request, erpWorkspaceCommandSchema, "ERP işlem bilgileri geçersiz.");
    return service().execute(principal.restaurantId, principal.user.id, requestId, command);
  });
}
