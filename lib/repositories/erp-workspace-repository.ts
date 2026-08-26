import type { ErpWorkspaceData, ErpWorkspaceQuery } from "@/lib/domain/erp-workspaces";
import type { ErpWorkspaceCommand } from "@/lib/validation/erp-workspace";
import type { ErpAuditContext } from "@/lib/repositories/erp-repository";

export interface ErpWorkspaceRepository {
  read(restaurantId: string, query: ErpWorkspaceQuery): Promise<ErpWorkspaceData>;
  execute(input: {
    readonly restaurantId: string;
    readonly command: ErpWorkspaceCommand;
    readonly audit: ErpAuditContext;
  }): Promise<Record<string, unknown>>;
}
