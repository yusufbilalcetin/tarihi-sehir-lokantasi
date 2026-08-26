import { DomainError } from "../api/domain-error";
import type { RepositoryJsonObject } from "../repositories/order-repository";
import type {
  CustomerCallContextRecord,
  CustomerWaiterCallRecord,
  WaiterCallRepository,
} from "../repositories/waiter-call-repository";

export type CustomerCallType = "WAITER_CALL" | "BILL_REQUEST";

export interface CreateCustomerCallCommand {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly tableAccessVersion: number;
  readonly type: CustomerCallType;
  readonly notes?: string;
}

export interface CreateCustomerCallResult {
  readonly id: string;
  readonly type: CustomerCallType;
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdAt: string;
  readonly replayed: boolean;
}

export interface WaiterCallServiceOptions {
  readonly clock?: () => Date;
}

function normalizeNotes(notes: string | undefined): string | null {
  if (notes === undefined) return null;
  const normalized = notes.trim();
  if (!normalized) return null;
  if (normalized.length > 500) {
    throw new DomainError("VALIDATION_ERROR", "Not en fazla 500 karakter olabilir.", {
      httpStatus: 400,
    });
  }
  return normalized;
}

function requireUsableContext(
  context: CustomerCallContextRecord | null,
  tableAccessVersion: number,
  type: CustomerCallType,
): CustomerCallContextRecord {
  if (!context || !context.restaurantIsActive || !context.tableIsActive) {
    throw new DomainError("TABLE_INACTIVE", "Masa şu anda servis isteği alamıyor.", {
      httpStatus: 403,
    });
  }
  if (
    context.tableTokenRevokedAt ||
    context.tableTokenVersion !== tableAccessVersion
  ) {
    throw new DomainError(
      "INVALID_TABLE_TOKEN",
      "Masa oturumunuz geçerli değil. Lütfen QR kodunu yeniden okutun.",
      { httpStatus: 401 },
    );
  }
  if (type === "WAITER_CALL" && !context.waiterCallEnabled) {
    throw new DomainError("CONFLICT", "Garson çağırma şu anda kullanılamıyor.", {
      httpStatus: 409,
    });
  }
  if (type === "BILL_REQUEST" && !context.billRequestEnabled) {
    throw new DomainError("CONFLICT", "Hesap isteme şu anda kullanılamıyor.", {
      httpStatus: 409,
    });
  }
  return context;
}

function toResult(
  call: CustomerWaiterCallRecord,
  replayed: boolean,
): CreateCustomerCallResult {
  if (call.type !== "WAITER_CALL" && call.type !== "BILL_REQUEST") {
    throw new DomainError("INTERNAL_ERROR", "Servis isteği işlenemedi.", {
      httpStatus: 500,
      expose: false,
    });
  }
  if (call.status !== "OPEN" && call.status !== "ACKNOWLEDGED") {
    throw new DomainError("INTERNAL_ERROR", "Servis isteği işlenemedi.", {
      httpStatus: 500,
      expose: false,
    });
  }
  return {
    id: call.id,
    type: call.type,
    status: call.status,
    createdAt: call.createdAt.toISOString(),
    replayed,
  };
}

/** The guest-facing shape of an outstanding request. No identifiers, no actors. */
export interface ActiveCustomerCall {
  readonly type: "WAITER_CALL" | "BILL_REQUEST";
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdAt: string;
}

export class WaiterCallService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: WaiterCallRepository,
    options: WaiterCallServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * What the guest's own table currently has outstanding.
   *
   * The scope is not negotiable and does not come from the request: the caller
   * hands over the restaurant and table it read from the signed table session,
   * and both are part of every query. A guest therefore cannot address another
   * table or another restaurant by changing anything they control.
   *
   * Only OPEN and ACKNOWLEDGED are returned — a resolved request is no longer
   * something the guest is waiting on, and returning it would invite the screen
   * to keep showing a request that is finished.
   */
  async readActiveCalls(scope: {
    readonly restaurantId: string;
    readonly tableId: string;
  }): Promise<readonly ActiveCustomerCall[]> {
    if (!scope.restaurantId || !scope.tableId) return [];

    const [waiterCall, billRequest] = await Promise.all([
      this.repository.findActiveCall(scope.restaurantId, scope.tableId, "WAITER_CALL"),
      this.repository.findActiveCall(scope.restaurantId, scope.tableId, "BILL_REQUEST"),
    ]);

    // Deliberately narrow: the guest needs to know which request is
    // outstanding and how far it has got. Who acknowledged it, which staff
    // member owns it and every internal identifier stay on the staff side.
    return [waiterCall, billRequest]
      .filter((call): call is NonNullable<typeof call> => call !== null)
      .map((call) => ({
        type: call.type as ActiveCustomerCall["type"],
        status: call.status as ActiveCustomerCall["status"],
        createdAt: call.createdAt.toISOString(),
      }));
  }

  createWaiterCall(
    command: Omit<CreateCustomerCallCommand, "type">,
  ): Promise<CreateCustomerCallResult> {
    return this.create({ ...command, type: "WAITER_CALL" });
  }

  createBillRequest(
    command: Omit<CreateCustomerCallCommand, "type">,
  ): Promise<CreateCustomerCallResult> {
    return this.create({ ...command, type: "BILL_REQUEST" });
  }

  private async create(
    command: CreateCustomerCallCommand,
  ): Promise<CreateCustomerCallResult> {
    if (
      !command.restaurantId ||
      !command.tableId ||
      !Number.isSafeInteger(command.tableAccessVersion) ||
      command.tableAccessVersion < 1
    ) {
      throw new DomainError("INVALID_TABLE_TOKEN", "Masa oturumu geçersiz.", {
        httpStatus: 401,
      });
    }
    const notes = normalizeNotes(command.notes);

    return this.repository.transaction(async (transaction) => {
      const now = this.clock();
      if (Number.isNaN(now.getTime())) {
        throw new DomainError("INTERNAL_ERROR", "Servis isteği işlenemedi.", {
          httpStatus: 500,
          expose: false,
        });
      }
      const context = requireUsableContext(
        await transaction.findContextForUpdate(
          command.restaurantId,
          command.tableId,
        ),
        command.tableAccessVersion,
        command.type,
      );

      const active = await transaction.findActiveCall(
        command.restaurantId,
        command.tableId,
        command.type,
      );
      if (active) return toResult(active, true);

      const recent = await transaction.findMostRecentCall(
        command.restaurantId,
        command.tableId,
        command.type,
      );
      const cooldownMs = context.waiterCallCooldownSeconds * 1_000;
      if (recent && now.getTime() - recent.createdAt.getTime() < cooldownMs) {
        throw new DomainError(
          "RATE_LIMITED",
          "Bu istek kısa süre önce gönderildi. Lütfen biraz bekleyin.",
          {
            httpStatus: 429,
            details: {
              retryAfterSeconds: Math.max(
                1,
                Math.ceil(
                  (cooldownMs - (now.getTime() - recent.createdAt.getTime())) /
                    1_000,
                ),
              ),
            },
          },
        );
      }

      const inserted = await transaction.insertCall({
        restaurantId: command.restaurantId,
        tableId: command.tableId,
        type: command.type,
        notes,
        tableTokenVersion: command.tableAccessVersion,
        createdAt: now,
      });
      if (!inserted) {
        const raced = await transaction.findActiveCall(
          command.restaurantId,
          command.tableId,
          command.type,
        );
        if (raced) return toResult(raced, true);
        throw new DomainError("CONFLICT", "Servis isteği oluşturulamadı.", {
          httpStatus: 409,
        });
      }

      await transaction.markTableForCall(
        command.restaurantId,
        command.tableId,
        command.type,
        now,
      );
      const eventType =
        command.type === "BILL_REQUEST" ? "BILL_REQUESTED" : "WAITER_CALLED";
      const payload: RepositoryJsonObject = {
        callId: inserted.id,
        type: command.type,
        status: inserted.status,
        tableId: command.tableId,
        tableName: context.tableName,
        tableNumber: context.tableNumber,
        createdAt: inserted.createdAt.toISOString(),
      };
      await transaction.insertOutbox({
        restaurantId: command.restaurantId,
        callId: inserted.id,
        eventType,
        payload,
      });
      await transaction.insertAudit({
        restaurantId: command.restaurantId,
        callId: inserted.id,
        action: eventType,
        newValue: {
          type: command.type,
          status: inserted.status,
          tableId: command.tableId,
        },
        metadata: {
          actorType: "CUSTOMER_TABLE_SESSION",
          tableTokenVersion: command.tableAccessVersion,
        },
      });
      return toResult(inserted, false);
    });
  }
}
