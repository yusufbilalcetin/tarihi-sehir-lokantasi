import "server-only";

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { apiFailure, apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { printerAgents } from "@/db/schema";
import { getPrinterAgentTokenPepper } from "@/lib/env/server";
import { auditRequestContext } from "@/lib/api/audit-request";
import { createLogger } from "@/lib/security/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import {
  readBearerToken,
  verifyAgentToken,
} from "@/lib/security/printer-agent-token";

/**
 * The one gate every print-agent endpoint goes through.
 *
 * An agent is not a browser session: there is no cookie, no CSRF surface and
 * no staff principal. It presents its own bearer token, which is compared
 * against a stored HMAC digest in constant time. A malformed token, an unknown
 * token, a revoked token and a deactivated agent all produce the same answer,
 * so nothing here reveals which agents exist.
 */

export interface PrinterAgentIdentity {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
}

const AGENT_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

function unauthorized(): NextResponse {
  return NextResponse.json(
    apiFailure({
      code: "PRINTER_AGENT_UNAUTHORIZED",
      message: "Yazdırma agent kimliği doğrulanamadı.",
    }),
    { status: 401, headers: AGENT_NO_STORE_HEADERS },
  );
}

/**
 * Resolves the agent behind a request, or null. The lookup fetches only active,
 * unrevoked agents, so revocation takes effect on the very next call.
 */
export async function resolvePrinterAgent(
  request: Request,
): Promise<PrinterAgentIdentity | null> {
  const rawToken = readBearerToken(request.headers.get("authorization"));
  if (!rawToken) return null;

  const pepper = getPrinterAgentTokenPepper();
  const candidates = await getDb()
    .select({
      id: printerAgents.id,
      restaurantId: printerAgents.restaurantId,
      name: printerAgents.name,
      tokenHash: printerAgents.tokenHash,
    })
    .from(printerAgents)
    .where(and(eq(printerAgents.isActive, true), isNull(printerAgents.revokedAt)));

  for (const agent of candidates) {
    if (verifyAgentToken(rawToken, agent.tokenHash, pepper)) {
      return { id: agent.id, restaurantId: agent.restaurantId, name: agent.name };
    }
  }
  return null;
}

/**
 * Shared envelope: authenticate, run the work, and never let an internal error
 * message reach the agent. The token is never logged, in success or failure.
 */
export async function printerAgentRoute<TResult>(
  request: Request,
  loggerScope: string,
  work: (agent: PrinterAgentIdentity) => Promise<TResult>,
): Promise<NextResponse> {
  const logger = createLogger(loggerScope);
  const requestId = auditRequestContext(request).requestId;
  try {
    // Applied before authentication, because authentication is the expensive
    // part: an unauthenticated caller must not be able to make the server scan
    // and HMAC every active agent as fast as it can send requests.
    await enforceRateLimit(request, "PRINTER_AGENT");

    const agent = await resolvePrinterAgent(request);
    if (!agent) return unauthorized();

    const result = await work(agent);
    return NextResponse.json(apiSuccess(result), {
      status: 200,
      headers: AGENT_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("agent_request_failed", "Printer agent request failed.", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: AGENT_NO_STORE_HEADERS,
    });
  }
}

export { AGENT_NO_STORE_HEADERS };
