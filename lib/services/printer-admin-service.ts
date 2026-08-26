import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  auditLogs,
  printJobs,
  printerAgents,
  printerRoutes,
  restaurantPrinters,
} from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { isSupportedEncoding } from "@/lib/domain/escpos";
import type { PrintDocumentType, PrinterStationType } from "@/lib/domain/print-document";
import { agentPresence } from "@/lib/domain/print-routing";
import type { RestaurantPrincipal } from "@/lib/domain/restaurant-scope";
import { getPrinterAgentTokenPepper } from "@/lib/env/server";
import { generateAgentToken } from "@/lib/security/printer-agent-token";

/**
 * Printer, agent and routing configuration.
 *
 * The one rule worth stating: an agent's raw token exists for exactly as long
 * as the response that carries it. It is returned once at creation or rotation,
 * never stored, never logged, and never written into an audit payload — only
 * its HMAC digest reaches the database.
 */

const SUPERVISOR_ROLES = ["ADMIN", "MANAGER"] as const;

function requireSupervisor(principal: RestaurantPrincipal): void {
  if (!(SUPERVISOR_ROLES as readonly string[]).includes(principal.role)) {
    throw new DomainError("FORBIDDEN", "Yazıcı yönetimi yetkiniz yok.", { httpStatus: 403 });
  }
}

function notFound(entity: string): DomainError {
  return new DomainError("NOT_FOUND", `${entity} bulunamadı.`, { httpStatus: 404 });
}

export interface AgentResult {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly tokenVersion: number;
  readonly lastSeenAt: string | null;
  readonly softwareVersion: string | null;
  readonly revokedAt: string | null;
  readonly presence: "ONLINE" | "OFFLINE" | "UNKNOWN";
}

export interface PrinterResult {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly stationType: PrinterStationType;
  readonly deviceKey: string;
  readonly charactersPerLine: number;
  readonly encoding: string;
  readonly autoCut: boolean;
  readonly defaultCopies: number;
  readonly isActive: boolean;
  readonly archived: boolean;
  readonly agentId: string;
  readonly agentName: string;
}

export class PrinterAdminService {
  constructor(private readonly db: Database = getDb()) {}

  // ------------------------------------------------------------------ agents

  async listAgents(
    principal: RestaurantPrincipal,
    now: Date = new Date(),
  ): Promise<readonly AgentResult[]> {
    requireSupervisor(principal);
    const rows = await this.db
      .select({
        id: printerAgents.id,
        name: printerAgents.name,
        isActive: printerAgents.isActive,
        tokenVersion: printerAgents.tokenVersion,
        lastSeenAt: printerAgents.lastSeenAt,
        softwareVersion: printerAgents.softwareVersion,
        revokedAt: printerAgents.revokedAt,
      })
      .from(printerAgents)
      .where(eq(printerAgents.restaurantId, principal.restaurantId))
      .orderBy(asc(printerAgents.name));
    return rows.map((row) => ({
      ...row,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      presence: agentPresence(row.lastSeenAt, now),
    }));
  }

  /** The only two moments the raw token is ever visible: here, and on rotate. */
  async createAgent(
    principal: RestaurantPrincipal,
    input: { readonly name: string; readonly requestId?: string },
  ): Promise<{ readonly agent: AgentResult; readonly rawToken: string }> {
    requireSupervisor(principal);
    const name = input.name.trim();
    if (!name) {
      throw new DomainError("VALIDATION_ERROR", "Agent adı gereklidir.", { httpStatus: 400 });
    }
    const token = generateAgentToken(getPrinterAgentTokenPepper());

    return this.db.transaction(async (transaction) => {
      const [agent] = await transaction
        .insert(printerAgents)
        .values({
          restaurantId: principal.restaurantId,
          name,
          tokenHash: token.tokenHash,
          tokenVersion: token.tokenVersion,
        })
        .returning({
          id: printerAgents.id,
          name: printerAgents.name,
          isActive: printerAgents.isActive,
          tokenVersion: printerAgents.tokenVersion,
        });
      if (!agent) {
        throw new DomainError("CONFLICT", "Agent oluşturulamadı.", { httpStatus: 409 });
      }
      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action: "printer_agent.created",
        entityType: "PRINTER_AGENT",
        entityId: agent.id,
        // The token itself is deliberately absent from the audit record.
        newValue: { name: agent.name, tokenVersion: agent.tokenVersion },
        requestId: input.requestId,
      });
      return {
        rawToken: token.rawToken,
        agent: {
          ...agent,
          lastSeenAt: null,
          softwareVersion: null,
          revokedAt: null,
          presence: "UNKNOWN" as const,
        },
      };
    });
  }

  /**
   * Rotation bumps the version, so the previous token stops verifying the
   * moment the new digest lands. Revocation is the same movement without a
   * replacement.
   */
  async updateAgent(
    principal: RestaurantPrincipal,
    input: {
      readonly agentId: string;
      readonly name?: string;
      readonly isActive?: boolean;
      readonly action?: "ROTATE_TOKEN" | "REVOKE";
      readonly requestId?: string;
    },
  ): Promise<{ readonly agent: AgentResult; readonly rawToken?: string }> {
    requireSupervisor(principal);

    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: printerAgents.id,
          name: printerAgents.name,
          isActive: printerAgents.isActive,
          tokenVersion: printerAgents.tokenVersion,
          lastSeenAt: printerAgents.lastSeenAt,
          softwareVersion: printerAgents.softwareVersion,
          revokedAt: printerAgents.revokedAt,
        })
        .from(printerAgents)
        .where(
          and(
            eq(printerAgents.restaurantId, principal.restaurantId),
            eq(printerAgents.id, input.agentId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) throw notFound("Agent");

      const now = new Date();
      let rawToken: string | undefined;
      const changes: Record<string, unknown> = { updatedAt: now };
      if (input.name !== undefined) changes.name = input.name.trim();
      if (input.isActive !== undefined) changes.isActive = input.isActive;

      if (input.action === "ROTATE_TOKEN") {
        const rotated = generateAgentToken(
          getPrinterAgentTokenPepper(),
          current.tokenVersion + 1,
        );
        rawToken = rotated.rawToken;
        changes.tokenHash = rotated.tokenHash;
        changes.tokenVersion = rotated.tokenVersion;
        changes.isActive = true;
        changes.revokedAt = null;
      }
      if (input.action === "REVOKE") {
        changes.isActive = false;
        changes.revokedAt = now;
      }

      const [updated] = await transaction
        .update(printerAgents)
        .set(changes)
        .where(
          and(
            eq(printerAgents.restaurantId, principal.restaurantId),
            eq(printerAgents.id, input.agentId),
          ),
        )
        .returning({
          id: printerAgents.id,
          name: printerAgents.name,
          isActive: printerAgents.isActive,
          tokenVersion: printerAgents.tokenVersion,
          lastSeenAt: printerAgents.lastSeenAt,
          softwareVersion: printerAgents.softwareVersion,
          revokedAt: printerAgents.revokedAt,
        });
      if (!updated) throw notFound("Agent");

      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action:
          input.action === "ROTATE_TOKEN"
            ? "printer_agent.token_rotated"
            : input.action === "REVOKE"
              ? "printer_agent.revoked"
              : "printer_agent.updated",
        entityType: "PRINTER_AGENT",
        entityId: updated.id,
        oldValue: { isActive: current.isActive, tokenVersion: current.tokenVersion },
        newValue: { isActive: updated.isActive, tokenVersion: updated.tokenVersion },
        requestId: input.requestId,
      });

      return {
        rawToken,
        agent: {
          ...updated,
          lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
          revokedAt: updated.revokedAt?.toISOString() ?? null,
          presence: agentPresence(updated.lastSeenAt, now),
        },
      };
    });
  }

  // ---------------------------------------------------------------- printers

  async listPrinters(principal: RestaurantPrincipal): Promise<readonly PrinterResult[]> {
    requireSupervisor(principal);
    const rows = await this.db
      .select({
        id: restaurantPrinters.id,
        name: restaurantPrinters.name,
        code: restaurantPrinters.code,
        stationType: restaurantPrinters.stationType,
        deviceKey: restaurantPrinters.deviceKey,
        charactersPerLine: restaurantPrinters.charactersPerLine,
        encoding: restaurantPrinters.encoding,
        autoCut: restaurantPrinters.autoCut,
        defaultCopies: restaurantPrinters.defaultCopies,
        isActive: restaurantPrinters.isActive,
        deletedAt: restaurantPrinters.deletedAt,
        agentId: printerAgents.id,
        agentName: printerAgents.name,
      })
      .from(restaurantPrinters)
      .innerJoin(
        printerAgents,
        and(
          eq(printerAgents.restaurantId, restaurantPrinters.restaurantId),
          eq(printerAgents.id, restaurantPrinters.printerAgentId),
        ),
      )
      .where(eq(restaurantPrinters.restaurantId, principal.restaurantId))
      .orderBy(asc(restaurantPrinters.name));
    return rows.map(({ deletedAt, ...row }) => ({
      ...row,
      stationType: row.stationType as PrinterStationType,
      archived: Boolean(deletedAt),
    }));
  }

  async createPrinter(
    principal: RestaurantPrincipal,
    input: {
      readonly agentId: string;
      readonly name: string;
      readonly code: string;
      readonly stationType: PrinterStationType;
      readonly deviceKey: string;
      readonly charactersPerLine: number;
      readonly encoding: string;
      readonly autoCut: boolean;
      readonly defaultCopies: number;
      readonly requestId?: string;
    },
  ): Promise<PrinterResult> {
    requireSupervisor(principal);
    // An unsupported code page would render mojibake at the counter, so it is
    // rejected here rather than discovered on paper.
    if (!isSupportedEncoding(input.encoding)) {
      throw new DomainError(
        "UNSUPPORTED_PRINTER_ENCODING",
        "Bu yazıcı kodlaması desteklenmiyor.",
        { httpStatus: 400, details: { encoding: input.encoding } },
      );
    }

    const [agent] = await this.db
      .select({ id: printerAgents.id, name: printerAgents.name })
      .from(printerAgents)
      .where(
        and(
          eq(printerAgents.restaurantId, principal.restaurantId),
          eq(printerAgents.id, input.agentId),
        ),
      )
      .limit(1);
    if (!agent) throw notFound("Agent");

    const rows = await this.db
      .insert(restaurantPrinters)
      .values({
        restaurantId: principal.restaurantId,
        printerAgentId: agent.id,
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        stationType: input.stationType,
        deviceKey: input.deviceKey.trim().toLowerCase(),
        charactersPerLine: input.charactersPerLine,
        encoding: input.encoding,
        autoCut: input.autoCut,
        defaultCopies: input.defaultCopies,
      })
      .onConflictDoNothing()
      .returning({ id: restaurantPrinters.id });
    const created = rows[0];
    if (!created) {
      throw new DomainError("CONFLICT", "Bu yazıcı kodu zaten kullanılıyor.", {
        httpStatus: 409,
      });
    }

    await this.db.insert(auditLogs).values({
      restaurantId: principal.restaurantId,
      actorUserId: principal.userId,
      action: "printer.created",
      entityType: "PRINTER",
      entityId: created.id,
      newValue: { name: input.name.trim(), deviceKey: input.deviceKey.trim() },
      requestId: input.requestId,
    });

    const printers = await this.listPrinters(principal);
    const printer = printers.find((row) => row.id === created.id);
    if (!printer) throw notFound("Yazıcı");
    return printer;
  }

  async updatePrinter(
    principal: RestaurantPrincipal,
    input: {
      readonly printerId: string;
      readonly name?: string;
      readonly deviceKey?: string;
      readonly charactersPerLine?: number;
      readonly encoding?: string;
      readonly autoCut?: boolean;
      readonly defaultCopies?: number;
      readonly isActive?: boolean;
      readonly archived?: boolean;
      readonly requestId?: string;
    },
  ): Promise<PrinterResult> {
    requireSupervisor(principal);
    if (input.encoding !== undefined && !isSupportedEncoding(input.encoding)) {
      throw new DomainError(
        "UNSUPPORTED_PRINTER_ENCODING",
        "Bu yazıcı kodlaması desteklenmiyor.",
        { httpStatus: 400 },
      );
    }

    const changes = Object.fromEntries(
      Object.entries({
        name: input.name?.trim(),
        deviceKey: input.deviceKey?.trim().toLowerCase(),
        charactersPerLine: input.charactersPerLine,
        encoding: input.encoding,
        autoCut: input.autoCut,
        defaultCopies: input.defaultCopies,
        isActive: input.archived ? false : input.isActive,
        deletedAt:
          input.archived === undefined ? undefined : input.archived ? new Date() : null,
      }).filter(([, value]) => value !== undefined),
    );

    const rows = await this.db
      .update(restaurantPrinters)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(restaurantPrinters.restaurantId, principal.restaurantId),
          eq(restaurantPrinters.id, input.printerId),
        ),
      )
      .returning({ id: restaurantPrinters.id });
    if (!rows[0]) throw notFound("Yazıcı");

    await this.db.insert(auditLogs).values({
      restaurantId: principal.restaurantId,
      actorUserId: principal.userId,
      action: "printer.updated",
      entityType: "PRINTER",
      entityId: input.printerId,
      newValue: changes as Record<string, never>,
      requestId: input.requestId,
    });

    const printers = await this.listPrinters(principal);
    const printer = printers.find((row) => row.id === input.printerId);
    if (!printer) throw notFound("Yazıcı");
    return printer;
  }

  // ------------------------------------------------------------------ routes

  async listRoutes(principal: RestaurantPrincipal) {
    requireSupervisor(principal);
    return this.db
      .select({
        id: printerRoutes.id,
        documentType: printerRoutes.documentType,
        categoryId: printerRoutes.categoryId,
        printerId: printerRoutes.printerId,
        printerName: restaurantPrinters.name,
        copies: printerRoutes.copies,
        isActive: printerRoutes.isActive,
      })
      .from(printerRoutes)
      .innerJoin(
        restaurantPrinters,
        and(
          eq(restaurantPrinters.restaurantId, printerRoutes.restaurantId),
          eq(restaurantPrinters.id, printerRoutes.printerId),
        ),
      )
      .where(eq(printerRoutes.restaurantId, principal.restaurantId))
      .orderBy(asc(printerRoutes.documentType), asc(restaurantPrinters.name));
  }

  async createRoute(
    principal: RestaurantPrincipal,
    input: {
      readonly documentType: PrintDocumentType;
      readonly categoryId?: string | null;
      readonly printerId: string;
      readonly copies: number;
      readonly requestId?: string;
    },
  ): Promise<{ readonly id: string }> {
    requireSupervisor(principal);
    const rows = await this.db
      .insert(printerRoutes)
      .values({
        restaurantId: principal.restaurantId,
        documentType: input.documentType,
        categoryId: input.categoryId ?? null,
        printerId: input.printerId,
        copies: input.copies,
      })
      // The unique indexes stop the same category being pointed twice at the
      // same printer, which would silently double every ticket.
      .onConflictDoNothing()
      .returning({ id: printerRoutes.id });
    const created = rows[0];
    if (!created) {
      throw new DomainError("CONFLICT", "Bu yönlendirme zaten tanımlı.", { httpStatus: 409 });
    }
    await this.db.insert(auditLogs).values({
      restaurantId: principal.restaurantId,
      actorUserId: principal.userId,
      action: "printer_route.created",
      entityType: "PRINTER_ROUTE",
      entityId: created.id,
      newValue: {
        documentType: input.documentType,
        categoryId: input.categoryId ?? null,
        printerId: input.printerId,
      },
      requestId: input.requestId,
    });
    return created;
  }

  async updateRoute(
    principal: RestaurantPrincipal,
    input: {
      readonly routeId: string;
      readonly isActive?: boolean;
      readonly copies?: number;
      readonly requestId?: string;
    },
  ): Promise<{ readonly id: string }> {
    requireSupervisor(principal);
    const changes = Object.fromEntries(
      Object.entries({ isActive: input.isActive, copies: input.copies }).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const rows = await this.db
      .update(printerRoutes)
      .set({ ...changes, updatedAt: new Date() })
      .where(
        and(
          eq(printerRoutes.restaurantId, principal.restaurantId),
          eq(printerRoutes.id, input.routeId),
        ),
      )
      .returning({ id: printerRoutes.id });
    if (!rows[0]) throw notFound("Yönlendirme");
    return rows[0];
  }

  /** Queue depth per printer, so the admin screen can show pressure at a glance. */
  async queueSummary(principal: RestaurantPrincipal) {
    requireSupervisor(principal);
    return this.db
      .select({
        status: printJobs.status,
        total: sql<number>`count(*)::int`,
      })
      .from(printJobs)
      .where(eq(printJobs.restaurantId, principal.restaurantId))
      .groupBy(printJobs.status);
  }
}
