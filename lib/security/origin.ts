import { DomainError } from "@/lib/api/domain-error";

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
/**
 * Cookie-authenticated mutations must originate from the request's own origin.
 * Browsers send `Origin` for fetch/form mutations; absence fails closed outside
 * test mode. The function never trusts X-Forwarded-Host supplied by arbitrary
 * clients and compares normalized origins, including non-default ports.
 */
export function assertTrustedMutationOrigin(request: Request): void {
  const originHeader = request.headers.get("origin");
  const requestOrigin = normalizeOrigin(request.url);
  const suppliedOrigin = originHeader ? normalizeOrigin(originHeader) : null;

  if (
    !requestOrigin ||
    !suppliedOrigin ||
    suppliedOrigin !== requestOrigin
  ) {
    throw new DomainError("FORBIDDEN", "İstek kaynağı doğrulanamadı.", {
      httpStatus: 403,
    });
  }
}
