import type {
  OrderItemStatus,
  OrderStatus,
  TableStatus,
  WaiterCallStatus,
  WaiterCallType,
} from "@/lib/domain/status";

export interface StaffTableOrderRecord {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly total: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly {
    readonly id: string;
    readonly productName: string;
    readonly quantity: number;
    readonly status: OrderItemStatus;
  }[];
}

export interface StaffTableCallRecord {
  readonly id: string;
  readonly type: WaiterCallType;
  readonly status: WaiterCallStatus;
  readonly requestLabel: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StaffTableRecord {
  readonly id: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly isActive: boolean;
  readonly currentStatus: TableStatus;
  readonly qrTokenVersion: number;
  readonly qrTokenRevokedAt: Date | null;
  readonly updatedAt: Date;
  readonly activeOrders: readonly StaffTableOrderRecord[];
  readonly activeCalls: readonly StaffTableCallRecord[];
}

export interface StaffTableRepository {
  listTables(restaurantId: string): Promise<readonly StaffTableRecord[]>;
}
