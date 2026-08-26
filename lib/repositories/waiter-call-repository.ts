import type {
  WaiterCallStatus,
  WaiterCallType,
} from "../domain/status";
import type { RepositoryJsonObject } from "./order-repository";

export interface CustomerCallContextRecord {
  readonly restaurantId: string;
  readonly restaurantIsActive: boolean;
  readonly tableId: string;
  readonly tableName: string;
  readonly tableNumber: number;
  readonly tableIsActive: boolean;
  readonly tableTokenVersion: number;
  readonly tableTokenRevokedAt: Date | null;
  readonly waiterCallEnabled: boolean;
  readonly billRequestEnabled: boolean;
  readonly waiterCallCooldownSeconds: number;
}

export interface CustomerWaiterCallRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly tableId: string;
  readonly type: WaiterCallType;
  readonly status: WaiterCallStatus;
  readonly notes: string | null;
  readonly tableTokenVersion: number;
  readonly createdAt: Date;
}

export interface CreateCustomerWaiterCallRecordInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">;
  readonly notes: string | null;
  readonly tableTokenVersion: number;
  readonly createdAt: Date;
}

export interface InsertCustomerCallOutboxInput {
  readonly restaurantId: string;
  readonly callId: string;
  readonly eventType: "WAITER_CALLED" | "BILL_REQUESTED";
  readonly payload: RepositoryJsonObject;
}

export interface InsertCustomerCallAuditInput {
  readonly restaurantId: string;
  readonly callId: string;
  readonly action: "WAITER_CALLED" | "BILL_REQUESTED";
  readonly newValue: RepositoryJsonObject;
  readonly metadata: RepositoryJsonObject;
}

export interface WaiterCallTransactionRepository {
  /** Locks the table row so same-table duplicate checks serialize. */
  findContextForUpdate(
    restaurantId: string,
    tableId: string,
  ): Promise<CustomerCallContextRecord | null>;
  findActiveCall(
    restaurantId: string,
    tableId: string,
    type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">,
  ): Promise<CustomerWaiterCallRecord | null>;
  findMostRecentCall(
    restaurantId: string,
    tableId: string,
    type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">,
  ): Promise<CustomerWaiterCallRecord | null>;
  insertCall(
    input: CreateCustomerWaiterCallRecordInput,
  ): Promise<CustomerWaiterCallRecord | null>;
  markTableForCall(
    restaurantId: string,
    tableId: string,
    type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">,
    at: Date,
  ): Promise<void>;
  insertOutbox(input: InsertCustomerCallOutboxInput): Promise<void>;
  insertAudit(input: InsertCustomerCallAuditInput): Promise<void>;
}

export interface WaiterCallRepository {
  transaction<TResult>(
    work: (repository: WaiterCallTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
  /**
   * The outstanding request of one type for one table. Reading needs no row
   * lock — unlike the create path, nothing here decides whether to write — so
   * it sits outside the transaction repository.
   */
  findActiveCall(
    restaurantId: string,
    tableId: string,
    type: Extract<WaiterCallType, "WAITER_CALL" | "BILL_REQUEST">,
  ): Promise<CustomerWaiterCallRecord | null>;
}
