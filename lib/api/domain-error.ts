import type { JsonValue } from "../domain/models";

export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "ACCOUNT_INACTIVE",
  "RESTAURANT_SCOPE_VIOLATION",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "INVALID_STATUS_TRANSITION",
  "INVALID_TABLE_TOKEN",
  "TABLE_INACTIVE",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "ORDER_NOT_FOUND",
  "WAITER_CALL_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_FLIGHT",
  "ORDER_NOT_MUTABLE",
  "ORDER_ALREADY_COMPLETED",
  "ORDER_ITEM_NOT_FOUND",
  "ORDER_ITEM_ALREADY_CANCELLED",
  "ITEM_CANNOT_BE_CANCELLED",
  "TABLE_NOT_FOUND",
  "TABLE_TARGET_OCCUPIED",
  "TABLE_HAS_OPEN_ORDER",
  "TABLE_TRANSFER_CONFLICT",
  "TABLE_MERGE_CONFLICT",
  "TABLE_RESET_BLOCKED",
  "ORDER_ITEM_ALREADY_VOIDED",
  "ITEM_CANNOT_BE_VOIDED",
  "PAYMENT_ALREADY_COMPLETED",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_EXCEEDS_BALANCE",
  "REFUND_EXCEEDS_REFUNDABLE",
  "ORDER_ALREADY_SETTLED",
  "CHECK_NOT_FOUND",
  "CHECK_ALLOCATION_INVALID",
  "CHECK_ALREADY_PAID",
  "CHECK_NOT_MUTABLE",
  // Phase 8A — cash drawer accountability.
  "CASHIER_SHIFT_REQUIRED",
  "CASHIER_SHIFT_ALREADY_OPEN",
  "CASHIER_SHIFT_CLOSED",
  "CASHIER_SHIFT_HAS_PENDING_PAYMENT",
  "CASHIER_SHIFT_NOTE_REQUIRED",
  // Phase 8B — operational X/Z reporting.
  "CASHIER_SHIFT_NOT_CLOSED",
  "LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT",
  // Phase 8C — printing. Delivery-level failures the agent reports live in
  // `PRINT_ERROR_CODES`; these are the ones that cross the API boundary.
  "PRINT_ROUTE_MISSING",
  "UNSUPPORTED_PRINT_PAYLOAD",
  "UNSUPPORTED_PRINTER_ENCODING",
  "PRINTER_AGENT_UNAUTHORIZED",
  // Phase 43 — catalog auto translation. The provider is a separate concern
  // from the menu itself, so its absence has its own name and never a 500.
  "TRANSLATION_PROVIDER_UNAVAILABLE",
  "TRANSLATION_IN_FLIGHT",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface DomainErrorOptions {
  readonly httpStatus?: number;
  readonly details?: JsonValue;
  /** False prevents the domain message/details from crossing the API boundary. */
  readonly expose?: boolean;
  readonly cause?: unknown;
}
export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly details?: JsonValue;
  readonly expose: boolean;

  constructor(code: ApiErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.details = options.details;
    this.expose = options.expose ?? this.httpStatus < 500;

    if (!Number.isInteger(this.httpStatus) || this.httpStatus < 400 || this.httpStatus > 599) {
      throw new TypeError("DomainError httpStatus must be an integer from 400 through 599.");
    }
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function validationError(message: string, details?: JsonValue): DomainError {
  return new DomainError("VALIDATION_ERROR", message, {
    httpStatus: 400,
    details,
  });
}
export function internalError(cause?: unknown): DomainError {
  return new DomainError("INTERNAL_ERROR", "Beklenmeyen bir sunucu hatası oluştu.", {
    httpStatus: 500,
    expose: false,
    cause,
  });
}
