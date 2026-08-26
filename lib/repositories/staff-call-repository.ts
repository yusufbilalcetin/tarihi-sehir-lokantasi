import type { RepositoryJsonObject } from "@/lib/repositories/order-repository";
import type {
  WaiterCallStatus,
  WaiterCallType,
} from "@/lib/domain/status";

export interface StaffCallListFilters {
  readonly type?: WaiterCallType;
  readonly status?: WaiterCallStatus;
  readonly limit: number;
}

export interface StaffCallListRecord {
  readonly id: string;
  readonly type: WaiterCallType;
  readonly status: WaiterCallStatus;
  readonly requestLabel: string | null;
  readonly notes: string | null;
  readonly tableId: string;
  readonly tableName: string;
  readonly tableNumber: number;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StaffCallUpdateInput {
  readonly callId: string;
  readonly nextStatus: Extract<WaiterCallStatus, "ACKNOWLEDGED" | "RESOLVED">;
  readonly actorStaffId: string;
  readonly at: Date;
}

export interface StaffCallOutboxInput {
  readonly restaurantId: string;
  readonly callId: string;
  readonly eventType: string;
  readonly payload: RepositoryJsonObject;
}

export interface StaffCallAuditInput {
  readonly restaurantId: string;
  readonly callId: string;
  readonly actorStaffId: string;
  readonly action: string;
  readonly oldValue: RepositoryJsonObject;
  readonly newValue: RepositoryJsonObject;
  readonly requestId?: string;
}

export interface StaffCallTableRecord {
  readonly id: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly isActive: boolean;
  readonly qrTokenVersion: number;
}

export interface StaffCallInsertInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly type: WaiterCallType;
  readonly requestLabel: string | null;
  readonly notes: string | null;
  readonly tableTokenVersion: number;
  readonly createdAt: Date;
}

export interface StaffCallTransactionRepository {
  /** Row lock keeps two waiters from acknowledging the same call twice. */
  findCallForUpdate(
    restaurantId: string,
    callId: string,
  ): Promise<StaffCallListRecord | null>;
  /** Locks the table row so two devices cannot open the same request type. */
  findTableForUpdate(
    restaurantId: string,
    tableId: string,
  ): Promise<StaffCallTableRecord | null>;
  findActiveCallForTable(
    restaurantId: string,
    tableId: string,
    type: WaiterCallType,
  ): Promise<StaffCallListRecord | null>;
  /** Returns null when the partial unique index rejects a duplicate. */
  insertCall(input: StaffCallInsertInput): Promise<StaffCallListRecord | null>;
  markTableForCall(
    restaurantId: string,
    tableId: string,
    type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">,
    at: Date,
  ): Promise<void>;
  updateCallStatus(
    restaurantId: string,
    input: StaffCallUpdateInput,
  ): Promise<StaffCallListRecord | null>;
  countActiveCallsForTable(restaurantId: string, tableId: string): Promise<number>;
  clearTableCallStatus(restaurantId: string, tableId: string, at: Date): Promise<void>;
  insertOutbox(input: StaffCallOutboxInput): Promise<void>;
  insertAudit(input: StaffCallAuditInput): Promise<void>;
}

export interface StaffCallRepository {
  listCalls(
    restaurantId: string,
    filters: StaffCallListFilters,
  ): Promise<readonly StaffCallListRecord[]>;
  transaction<TResult>(
    work: (repository: StaffCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
