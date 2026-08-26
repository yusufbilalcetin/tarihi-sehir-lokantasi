import type { TableStatus } from "@/lib/domain/status";

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
  readonly activeOrderId: string | null;
  readonly activeOrderNumber: string | null;
  readonly activeOrderTotal: string | null;
  readonly activeOrderCreatedAt: Date | null;
  readonly openCallCount: number;
}

export interface StaffTableRepository {
  listTables(restaurantId: string): Promise<readonly StaffTableRecord[]>;
}
