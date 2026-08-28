import { DomainError } from "@/lib/api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import { USER_ROLES } from "@/lib/domain/status";
import { deriveTableStatus } from "@/lib/domain/table-operations";
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
  readonly activeCalls?: readonly {
    readonly id: string;
    readonly type: "WAITER_CALL" | "BILL_REQUEST" | "OTHER";
    readonly status: string;
    readonly requestLabel: string | null;
    readonly createdAt: string;
  }[];
  readonly activeOrder: {
    readonly id: string;
    readonly orderNumber: string;
    readonly total: string;
    readonly createdAt: string;
    readonly status?: string;
    readonly orderCount?: number;
    readonly itemCount?: number;
    readonly items?: readonly {
      readonly id: string;
      readonly productName: string;
      readonly quantity: number;
      readonly status: string;
    }[];
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
    return records.map((table) => {
      const latestOrder = table.activeOrders[0] ?? null;
      const activityTimes = [
        table.updatedAt,
        ...table.activeOrders.map((order) => order.updatedAt),
        ...table.activeCalls.map((call) => call.updatedAt),
      ];
      const lastActivityAt = activityTimes.reduce(
        (latest, candidate) => candidate > latest ? candidate : latest,
        table.updatedAt,
      );
      return {
      id: table.id,
      name: table.name,
      number: table.tableNumber,
      seats: table.seats,
      isActive: table.isActive,
      status: deriveTableStatus({
        isActive: table.isActive,
        openOrderCount: table.activeOrders.length,
        activeCallTypes: table.activeCalls.map((call) => call.type),
        currentStatus: table.currentStatus,
      }),
      qrTokenVersion: table.qrTokenVersion,
      qrRevoked: Boolean(table.qrTokenRevokedAt),
      openCallCount: table.activeCalls.length,
      lastActivityAt: lastActivityAt.toISOString(),
      activeCalls: table.activeCalls.map((call) => ({
        id: call.id,
        type: call.type,
        status: call.status,
        requestLabel: call.requestLabel,
        createdAt: call.createdAt.toISOString(),
      })),
      activeOrder: latestOrder
        ? {
            id: latestOrder.id,
            orderNumber: latestOrder.orderNumber,
            status: latestOrder.status,
            total: table.activeOrders
              .reduce((sum, order) => sum + Number(order.total), 0)
              .toFixed(2),
            createdAt: table.activeOrders.at(-1)?.createdAt.toISOString() ?? latestOrder.createdAt.toISOString(),
            orderCount: table.activeOrders.length,
            itemCount: table.activeOrders.reduce(
              (sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0),
              0,
            ),
            items: table.activeOrders.flatMap((order) => order.items),
          }
        : null,
      };
    });
  }
}
