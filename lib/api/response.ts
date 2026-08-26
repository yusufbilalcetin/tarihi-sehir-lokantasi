import type { JsonValue } from "../domain/models";
import { DomainError, internalError, isDomainError, type ApiErrorCode } from "./domain-error";

export interface ApiPaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
export interface ApiMeta {
  readonly requestId?: string;
  readonly timestamp?: string;
  readonly pagination?: ApiPaginationMeta;
}

export interface ApiSuccess<TData> {
  readonly success: true;
  readonly data: TData;
  readonly meta?: ApiMeta;
}

export interface ApiErrorPayload {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly details?: JsonValue;
}

export interface ApiFailure {
  readonly success: false;
  readonly error: ApiErrorPayload;
  readonly meta?: ApiMeta;
}

export type ApiResult<TData> = ApiSuccess<TData> | ApiFailure;

export interface ApiFailureResult {
  readonly status: number;
  readonly body: ApiFailure;
}

const SAFE_INTERNAL_MESSAGE = "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

export function apiSuccess<TData>(data: TData, meta?: ApiMeta): ApiSuccess<TData> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function apiFailure(error: ApiErrorPayload, meta?: ApiMeta): ApiFailure {
  return meta ? { success: false, error, meta } : { success: false, error };
}

/**
 * Converts expected domain errors and unknown exceptions to a safe API value.
 * Unknown errors and non-exposed domain errors never leak stack/cause/details.
 */
/**
 * PostgreSQL's "invalid input syntax" for a typed column.
 *
 * A path or body carrying `abc` where the column holds a UUID is a malformed
 * request, not a server fault: the row simply cannot exist. Mapping it here
 * rather than in each route means every endpoint answers the same way, and the
 * driver's own wording never reaches the caller.
 */
const INVALID_TEXT_REPRESENTATION = "22P02";

function isMalformedIdentifier(error: unknown): boolean {
  // The query layer wraps driver errors, so the cause chain is walked rather
  // than only the outermost error. Bounded, so a cycle cannot spin here.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === INVALID_TEXT_REPRESENTATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function apiFailureFromUnknown(error: unknown, meta?: ApiMeta): ApiFailureResult {
  const domainError: DomainError = isDomainError(error)
    ? error
    : isMalformedIdentifier(error)
      ? new DomainError("VALIDATION_ERROR", "Kimlik biçimi geçersiz.", { httpStatus: 400 })
      : internalError(error);
  const exposed = domainError.expose;

  return {
    status: domainError.httpStatus,
    body: apiFailure(
      {
        code: exposed ? domainError.code : "INTERNAL_ERROR",
        message: exposed ? domainError.message : SAFE_INTERNAL_MESSAGE,
        ...(exposed && domainError.details !== undefined
          ? { details: domainError.details }
          : {}),
      },
      meta,
    ),
  };
}
