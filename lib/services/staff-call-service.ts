import { DomainError } from "@/lib/api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import {
  WAITER_CALL_STATUS_TRANSITIONS,
  validateStatusTransition,
  type UserRole,
  type WaiterCallStatus,
  type WaiterCallType,
} from "@/lib/domain/status";
import type {
  StaffCallListFilters,
  StaffCallListRecord,
  StaffCallRepository,
} from "@/lib/repositories/staff-call-repository";

const CALL_READER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
  "CASHIER",
] as const satisfies readonly UserRole[];

const CALL_HANDLER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
  "CASHIER",
] as const satisfies readonly UserRole[];

export type StaffCallNextStatus = Extract<WaiterCallStatus, "ACKNOWLEDGED" | "RESOLVED">;

export interface UpdateStaffCallCommand {
  readonly callId: string;
  readonly nextStatus: StaffCallNextStatus;
  readonly requestId?: string;
}

export interface CreateStaffCallCommand {
  readonly tableId: string;
  readonly type: WaiterCallType;
  readonly requestLabel?: string;
  readonly notes?: string;
  readonly requestId?: string;
}

/**
 * Staff-opened requests reuse the guest event vocabulary so the outbox, audit
 * trail and staff panels stay on one set of names.
 */
const CREATE_EVENT_TYPES: Readonly<Record<WaiterCallType, string>> = {
  WAITER_CALL: "WAITER_CALLED",
  BILL_REQUEST: "BILL_REQUESTED",
  OTHER: "TABLE_NOTE_ADDED",
};

export interface StaffCallServiceOptions {
  readonly clock?: () => Date;
}

function normalizeText(
  value: string | undefined,
  maximum: number,
  field: string,
): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new DomainError("VALIDATION_ERROR", `${field} en fazla ${maximum} karakter olabilir.`, {
      httpStatus: 400,
    });
  }
  return normalized;
}

function toResult(call: StaffCallListRecord) {
  return {
    id: call.id,
    type: call.type,
    status: call.status,
    requestLabel: call.requestLabel,
    notes: call.notes,
    table: { id: call.tableId, name: call.tableName, number: call.tableNumber },
    acknowledgedAt: call.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: call.resolvedAt?.toISOString() ?? null,
    createdAt: call.createdAt.toISOString(),
    updatedAt: call.updatedAt.toISOString(),
  };
}

/**
 * Cashiers only ever handle bill requests; every other scope check is the
 * shared restaurant-principal authorization.
 */
function authorize(
  principal: RestaurantPrincipal | null | undefined,
  allowedRoles: readonly UserRole[],
  action: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
    allowedRoles,
  });
  if (decision.allowed) return decision.principal;
  const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
  throw new DomainError(
    authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
    authenticationFailure ? "Oturum açmanız gerekiyor." : `${action} yetkiniz yok.`,
    { httpStatus: authenticationFailure ? 401 : 403 },
  );
}

export class StaffCallService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: StaffCallRepository,
    options: StaffCallServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async listCalls(
    principal: RestaurantPrincipal | null | undefined,
    filters: StaffCallListFilters,
  ) {
    const actor = authorize(principal, CALL_READER_ROLES, "Servis isteklerini görüntüleme");
    const scopedFilters = actor.role === "CASHIER"
      ? { ...filters, type: "BILL_REQUEST" as const }
      : filters;
    const calls = await this.repository.listCalls(actor.restaurantId, scopedFilters);
    return calls.map(toResult);
  }

  /**
   * Opens a service request from a staff device. The active (restaurant, table,
   * type) row is the idempotency key: a second tap returns the existing request
   * instead of creating a duplicate, which the partial unique index also
   * enforces at the database level.
   */
  async createCall(
    principal: RestaurantPrincipal | null | undefined,
    command: CreateStaffCallCommand,
  ) {
    const actor = authorize(principal, CALL_HANDLER_ROLES, "Servis isteği oluşturma");
    if (actor.role === "CASHIER" && command.type !== "BILL_REQUEST") {
      throw new DomainError("FORBIDDEN", "Bu servis isteği için yetkiniz yok.", {
        httpStatus: 403,
      });
    }

    const requestLabel = normalizeText(command.requestLabel, 120, "Etiket");
    const notes = normalizeText(command.notes, 500, "Not");

    return this.repository.transaction(async (transaction) => {
      const table = await transaction.findTableForUpdate(actor.restaurantId, command.tableId);
      if (!table) {
        throw new DomainError("NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
      }
      if (!table.isActive) {
        throw new DomainError("TABLE_INACTIVE", "Masa şu anda servis isteği alamıyor.", {
          httpStatus: 409,
        });
      }

      const existing = await transaction.findActiveCallForTable(
        actor.restaurantId,
        command.tableId,
        command.type,
      );
      if (existing) return { call: toResult(existing), created: false };

      const at = this.clock();
      const inserted = await transaction.insertCall({
        restaurantId: actor.restaurantId,
        tableId: command.tableId,
        type: command.type,
        requestLabel,
        notes,
        tableTokenVersion: table.qrTokenVersion,
        createdAt: at,
      });
      if (!inserted) {
        // Lost the race against another device; the winner's row is the truth.
        const raced = await transaction.findActiveCallForTable(
          actor.restaurantId,
          command.tableId,
          command.type,
        );
        if (raced) return { call: toResult(raced), created: false };
        throw new DomainError("CONFLICT", "Servis isteği oluşturulamadı.", { httpStatus: 409 });
      }

      // A note is an annotation, not a service call, so it never repaints the
      // table's operational status.
      if (command.type !== "OTHER") {
        await transaction.markTableForCall(
          actor.restaurantId,
          command.tableId,
          command.type,
          at,
        );
      }

      const payload = {
        callId: inserted.id,
        type: inserted.type,
        status: inserted.status,
        tableId: table.id,
        tableName: table.name,
        tableNumber: table.tableNumber,
        createdAt: inserted.createdAt.toISOString(),
      };
      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        callId: inserted.id,
        eventType: CREATE_EVENT_TYPES[command.type],
        payload,
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        callId: inserted.id,
        actorStaffId: actor.userId,
        action: "waiter_call.created",
        oldValue: {},
        newValue: { type: inserted.type, status: inserted.status, tableId: table.id },
        requestId: command.requestId,
      });

      return { call: toResult(inserted), created: true };
    });
  }

  async updateStatus(
    principal: RestaurantPrincipal | null | undefined,
    command: UpdateStaffCallCommand,
  ) {
    const actor = authorize(principal, CALL_HANDLER_ROLES, "Servis isteğini güncelleme");

    return this.repository.transaction(async (transaction) => {
      const call = await transaction.findCallForUpdate(actor.restaurantId, command.callId);
      if (!call) {
        throw new DomainError("WAITER_CALL_NOT_FOUND", "Servis isteği bulunamadı.", {
          httpStatus: 404,
        });
      }
      if (actor.role === "CASHIER" && call.type !== "BILL_REQUEST") {
        throw new DomainError("FORBIDDEN", "Bu servis isteği için yetkiniz yok.", {
          httpStatus: 403,
        });
      }

      const transition = validateStatusTransition(
        WAITER_CALL_STATUS_TRANSITIONS,
        call.status,
        command.nextStatus,
      );
      if (!transition.valid) {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          "Servis isteği bu duruma geçirilemez.",
          { httpStatus: 409, details: { from: call.status, to: command.nextStatus } },
        );
      }

      const at = this.clock();
      const updated = await transaction.updateCallStatus(actor.restaurantId, {
        callId: command.callId,
        nextStatus: command.nextStatus,
        actorStaffId: actor.userId,
        at,
      });
      if (!updated) {
        throw new DomainError("WAITER_CALL_NOT_FOUND", "Servis isteği bulunamadı.", {
          httpStatus: 404,
        });
      }

      // A table keeps its call badge until the last open request is cleared.
      if (command.nextStatus === "RESOLVED") {
        const remaining = await transaction.countActiveCallsForTable(
          actor.restaurantId,
          call.tableId,
        );
        if (remaining === 0) {
          await transaction.clearTableCallStatus(actor.restaurantId, call.tableId, at);
        }
      }

      const eventPrefix = call.type === "BILL_REQUEST" ? "BILL_REQUEST" : "WAITER_CALL";
      await transaction.insertOutbox({
        restaurantId: actor.restaurantId,
        callId: call.id,
        eventType: `${eventPrefix}_${command.nextStatus}`,
        payload: {
          callId: call.id,
          type: call.type,
          status: command.nextStatus,
          tableId: call.tableId,
          tableName: call.tableName,
          tableNumber: call.tableNumber,
          createdAt: call.createdAt.toISOString(),
          resolvedAt: updated.resolvedAt?.toISOString() ?? null,
        },
      });
      await transaction.insertAudit({
        restaurantId: actor.restaurantId,
        callId: call.id,
        actorStaffId: actor.userId,
        action: `waiter_call.${command.nextStatus.toLowerCase()}`,
        oldValue: { status: call.status },
        newValue: { status: command.nextStatus },
        requestId: command.requestId,
      });

      return toResult(updated);
    });
  }
}
