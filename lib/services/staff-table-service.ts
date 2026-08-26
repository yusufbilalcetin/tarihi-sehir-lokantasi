import { DomainError } from "@/lib/api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import { USER_ROLES } from "@/lib/domain/status";
import type { StaffTableRepository } from "@/lib/repositories/staff-table-repository";

export interface StaffTableResult {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly seats: number;
  readonly isActive: boolean;
  readonly status: string;
  readonly qrTokenVersion: number;
  readonly qrRevoked: boolean;
  readonly openCallCount: number;
  readonly lastActivityAt: string;
  readonly activeOrder: {
    readonly id: string;
    readonly orderNumber: string;
    readonly total: string;
    readonly createdAt: string;
  } | null;
}

export class StaffTableService {
  constructor(private readonly repository: StaffTableRepository) {}

  async listTables(
    principal: RestaurantPrincipal | null | undefined,
  ): Promise<readonly StaffTableResult[]> {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles: USER_ROLES,
    });
    if (!decision.allowed) {
      const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
      throw new DomainError(
        authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
        authenticationFailure ? "Oturum açmanız gerekiyor." : "Masaları görüntüleme yetkiniz yok.",
        { httpStatus: authenticationFailure ? 401 : 403 },
      );
    }

    const records = await this.repository.listTables(decision.principal.restaurantId);
    return records.map((table) => ({
      id: table.id,
      name: table.name,
      number: table.tableNumber,
      seats: table.seats,
      isActive: table.isActive,
      status: table.currentStatus,
      qrTokenVersion: table.qrTokenVersion,
      qrRevoked: Boolean(table.qrTokenRevokedAt),
      openCallCount: Number(table.openCallCount ?? 0),
      lastActivityAt: table.updatedAt.toISOString(),
      activeOrder: table.activeOrderId && table.activeOrderNumber && table.activeOrderTotal && table.activeOrderCreatedAt
        ? {
            id: table.activeOrderId,
            orderNumber: table.activeOrderNumber,
            total: table.activeOrderTotal,
            createdAt: table.activeOrderCreatedAt.toISOString(),
          }
        : null,
    }));
  }
}
