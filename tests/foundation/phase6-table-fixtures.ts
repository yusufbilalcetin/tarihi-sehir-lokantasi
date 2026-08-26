import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type { TableStatus } from "../../lib/domain/status";
import type {
  TableCheckBalanceRecord,
  TableOperationAuditInput,
  TableOperationCallRecord,
  TableOperationOrderRecord,
  TableOperationOutboxInput,
  TableOperationTableRecord,
  TableOperationsRepository,
  TableOperationsTransactionRepository,
} from "../../lib/repositories/table-operations-repository";
import { TableOperationsService } from "../../lib/services/table-operations-service";

export const FIXED_NOW = () => new Date("2026-08-14T19:00:00.000Z");

export function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-1",
    role,
    isActive: true,
  };
}

export function table(
  overrides: Partial<TableOperationTableRecord> = {},
): TableOperationTableRecord {
  return {
    id: "table-3",
    name: "Masa 3",
    tableNumber: 3,
    isActive: true,
    currentStatus: "OCCUPIED",
    ...overrides,
  };
}

export function openOrder(
  overrides: Partial<TableOperationOrderRecord> = {},
): TableOperationOrderRecord {
  return {
    id: "order-1",
    orderNumber: "ORD-000120",
    status: "CONFIRMED",
    total: "550.00",
    ...overrides,
  };
}

export function call(
  overrides: Partial<TableOperationCallRecord> = {},
): TableOperationCallRecord {
  return { id: "call-1", type: "WAITER_CALL", status: "OPEN", ...overrides };
}

export interface TableFixtureState {
  tables: TableOperationTableRecord[];
  ordersByTable: Record<string, TableOperationOrderRecord[]>;
  callsByTable: Record<string, TableOperationCallRecord[]>;
  /** Collected and refunded money per order, for the reset guard. */
  paidByOrder: Record<string, string>;
  refundedByOrder: Record<string, string>;
  checksByTable: Record<string, TableCheckBalanceRecord[]>;
  pendingPaymentsByTable: Record<string, number>;
  movedOrders: { orderIds: string[]; targetTableId: string }[];
  movedCalls: { callId: string; targetTableId: string }[];
  resolvedCalls: string[];
  statusUpdates: { tableId: string; status: TableStatus }[];
  outbox: TableOperationOutboxInput[];
  audits: TableOperationAuditInput[];
  /** Simulates orders changing under the lock between read and update. */
  moveOrdersReturnsFewer: boolean;
}

export function state(overrides: Partial<TableFixtureState> = {}): TableFixtureState {
  return {
    tables: [
      table({ id: "table-3", name: "Masa 3", tableNumber: 3 }),
      table({ id: "table-8", name: "Masa 8", tableNumber: 8, currentStatus: "AVAILABLE" }),
    ],
    ordersByTable: { "table-3": [openOrder()], "table-8": [] },
    callsByTable: { "table-3": [], "table-8": [] },
    paidByOrder: {},
    refundedByOrder: {},
    checksByTable: {},
    pendingPaymentsByTable: {},
    movedOrders: [],
    movedCalls: [],
    resolvedCalls: [],
    statusUpdates: [],
    outbox: [],
    audits: [],
    moveOrdersReturnsFewer: false,
    ...overrides,
  };
}

export class FakeTableOperationsRepository implements TableOperationsRepository {
  constructor(readonly state: TableFixtureState) {}

  async transaction<TResult>(
    work: (repository: TableOperationsTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this.port());
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }

  private port(): TableOperationsTransactionRepository {
    const state = this.state;
    return {
      async findTablesForUpdate(_restaurantId, tableIds) {
        return state.tables
          .filter((candidate) => tableIds.includes(candidate.id))
          .sort((left, right) => left.id.localeCompare(right.id));
      },
      async listOpenOrders(_restaurantId, tableId) {
        return state.ordersByTable[tableId] ?? [];
      },
      async listUnclosedOrderBalances(_restaurantId, tableId) {
        return (state.ordersByTable[tableId] ?? []).map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: order.total,
          paidTotal: state.paidByOrder[order.id] ?? "0.00",
          refundedTotal: state.refundedByOrder[order.id] ?? "0.00",
        }));
      },
      async listOpenChecks(_restaurantId, tableId) {
        return state.checksByTable[tableId] ?? [];
      },
      async countPendingPayments(_restaurantId, tableId) {
        return state.pendingPaymentsByTable[tableId] ?? 0;
      },
      async listActiveCalls(_restaurantId, tableId) {
        return state.callsByTable[tableId] ?? [];
      },
      async moveOrders(_restaurantId, orderIds, targetTableId) {
        state.movedOrders.push({ orderIds: [...orderIds], targetTableId });
        return state.moveOrdersReturnsFewer
          ? Math.max(0, orderIds.length - 1)
          : orderIds.length;
      },
      async moveCall(_restaurantId, callId, targetTableId) {
        state.movedCalls.push({ callId, targetTableId });
        return true;
      },
      async resolveCall(_restaurantId, callId) {
        state.resolvedCalls.push(callId);
        return true;
      },
      async setTableStatus(_restaurantId, tableId, status) {
        state.statusUpdates.push({ tableId, status });
      },
      async insertOutbox(input) {
        state.outbox.push(input);
      },
      async insertAudit(input) {
        state.audits.push(input);
      },
    };
  }
}

export function service(fixtureState: TableFixtureState): TableOperationsService {
  return new TableOperationsService(new FakeTableOperationsRepository(fixtureState), {
    clock: FIXED_NOW,
  });
}
