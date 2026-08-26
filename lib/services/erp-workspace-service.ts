import type { ErpWorkspaceModule, ErpWorkspaceQuery } from "@/lib/domain/erp-workspaces";
import type { ErpWorkspaceRepository } from "@/lib/repositories/erp-workspace-repository";
import type { ErpWorkspaceCommand } from "@/lib/validation/erp-workspace";

export class ErpWorkspaceService {
  constructor(private readonly repository: ErpWorkspaceRepository) {}

  read(restaurantId: string, module: ErpWorkspaceModule, query: Omit<ErpWorkspaceQuery, "module">) {
    return this.repository.read(restaurantId, { module, ...query });
  }

  execute(restaurantId: string, actorStaffId: string, requestId: string, command: ErpWorkspaceCommand) {
    return this.repository.execute({ restaurantId, command, audit: { actorStaffId, requestId } });
  }
}
