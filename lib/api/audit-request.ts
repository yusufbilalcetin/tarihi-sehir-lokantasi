import { randomUUID } from "node:crypto";

/**
 * The correlation id for one request.
 *
 * A caller-supplied `x-request-id` is honoured when it is well formed, so a
 * trace started at the edge survives into our logs and audit rows; anything
 * else gets a fresh id rather than being trusted into a log field.
 */
export function requestIdFrom(source: Pick<Headers, "get">): string {
  const supplied = source.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

/**
 * The same id, for an envelope that was never handed the `Request`.
 *
 * The read envelopes take only the work to do, so they reach the ambient
 * request through `next/headers`. Outside a request scope — a background job, a
 * unit test — there is nothing to correlate to, and a fresh id still keeps a
 * single log line internally joinable.
 */
export async function currentRequestId(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    return requestIdFrom(await headers());
  } catch {
    return randomUUID();
  }
}

export function auditRequestContext(request: Request) {
  const requestId = requestIdFrom(request.headers);
  const ipAddress =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    undefined;
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || undefined;
  return { requestId, ipAddress, userAgent };
}
