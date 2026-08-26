import type { ApiErrorCode } from "./domain-error";
import type { ApiResult } from "./response";

export type ApiClientErrorCode = ApiErrorCode | "NETWORK_ERROR";

/** Every non-2xx or non-success payload reaches callers as this single type. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiClientErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
  /** Multipart bodies bypass JSON encoding (product image upload). */
  readonly formData?: FormData;
}

const NETWORK_MESSAGE = "Bağlantı hatası oluştu.";
const UNEXPECTED_MESSAGE = "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

export async function apiRequest<TData>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TData> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined && !options.formData ? "GET" : "POST"),
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError("NETWORK_ERROR", NETWORK_MESSAGE, 0);
  }

  let payload: ApiResult<TData> | null = null;
  try {
    payload = (await response.json()) as ApiResult<TData>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.success !== true) {
    const failure = payload && payload.success === false ? payload.error : null;
    throw new ApiClientError(
      failure?.code ?? "INTERNAL_ERROR",
      failure?.message ?? UNEXPECTED_MESSAGE,
      response.status,
      failure?.details,
    );
  }

  return payload.data;
}

/** Client-generated key so a retried submit never creates a second order. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
