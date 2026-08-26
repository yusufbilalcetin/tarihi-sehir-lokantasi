import { isDomainError } from "@/lib/api/domain-error";

export function retryAfterHeader(error: unknown): Record<string, string> {
  if (!isDomainError(error) || error.code !== "RATE_LIMITED") return {};
  const details = error.details;
  if (
    !details ||
    typeof details !== "object" ||
    !("retryAfterSeconds" in details)
  ) return {};
  const retryAfter = details.retryAfterSeconds;
  return typeof retryAfter === "number" && Number.isSafeInteger(retryAfter) && retryAfter > 0
    ? { "Retry-After": String(retryAfter) }
    : {};
}
