import { getDb } from "@/db";
import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { DrizzleErpRepository } from "@/lib/repositories/drizzle-erp-repository";
import { ErpService } from "@/lib/services/erp-service";
import { erpCommandSchema } from "@/lib/validation/erp";

function service() { return new ErpService(new DrizzleErpRepository(getDb())); }

export async function GET() {
  return adminRead("api.admin.erp.read", ({ principal }) => service().overview(principal.restaurantId));
}

export async function POST(request: Request) {
  return adminMutation(request, "api.admin.erp.mutate", async ({ principal, requestId }) => {
    const command = await parseBody(request, erpCommandSchema, "ERP işlem bilgileri geçersiz.");
    return service().execute(principal.restaurantId, principal.user.id, requestId, command);
  }, 201);
}
