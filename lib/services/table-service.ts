import { DomainError, internalError } from "../api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "../domain/restaurant-scope";
import type { UserRole } from "../domain/status";
import type {
  AuditRequestContext,
  ManagedTableRecord,
  TableRepository,
} from "../repositories/table-repository";

const TABLE_MANAGEMENT_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

export interface TableTokenCodec {
  generate(): { readonly rawToken: string; readonly tokenHash: string };
  hash(rawToken: string): string;
  verify(rawToken: unknown, storedHash: string): boolean;
}

export interface ValidatedTableSession {
  readonly restaurant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly currency: string;
    readonly timezone: string;
  };
  readonly table: {
    readonly id: string;
    readonly name: string;
    readonly tableNumber: number;
    readonly seats: number;
    readonly accessVersion: number;
  };
}

export interface ManagedTableResult {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly accessVersion: number;
  readonly tokenRevokedAt: string | null;
  readonly isActive: boolean;
}

export interface CreateTableInput {
  readonly restaurantId: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly audit?: AuditRequestContext;
}

export interface ChangeTableTokenInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly audit?: AuditRequestContext;
}

export interface UpdateTableInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly name?: string;
  readonly seats?: number;
  readonly isActive?: boolean;
  readonly audit?: AuditRequestContext;
}

function invalidTableToken(): DomainError {
  return new DomainError("INVALID_TABLE_TOKEN", "Masa bağlantısı geçersiz.", {
    httpStatus: 404,
  });
}

function requireTableManager(
  principal: RestaurantPrincipal | null | undefined,
  restaurantId: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, restaurantId, {
    allowedRoles: TABLE_MANAGEMENT_ROLES,
  });
  if (decision.allowed) return decision.principal;

  if (decision.reason === "AUTHENTICATION_REQUIRED") {
    throw new DomainError("AUTHENTICATION_REQUIRED", "Oturum açmanız gerekiyor.", {
      httpStatus: 401,
    });
  }
  if (decision.reason === "ACCOUNT_INACTIVE") {
    throw new DomainError("ACCOUNT_INACTIVE", "Hesap aktif degil.", { httpStatus: 403 });
  }
  if (decision.reason === "RESTAURANT_SCOPE_MISMATCH") {
    throw new DomainError("RESTAURANT_SCOPE_VIOLATION", "Restoran erisimi reddedildi.", {
      httpStatus: 403,
    });
  }
  throw new DomainError("FORBIDDEN", "Bu işlem için yetkiniz bulunmuyor.", {
    httpStatus: 403,
  });
}

function managedTableDto(table: ManagedTableRecord): ManagedTableResult {
  return {
    id: table.id,
    restaurantId: table.restaurantId,
    name: table.name,
    tableNumber: table.tableNumber,
    seats: table.seats,
    accessVersion: table.qrTokenVersion,
    tokenRevokedAt: table.qrTokenRevokedAt?.toISOString() ?? null,
    isActive: table.isActive,
  };
}

function validateCreateInput(input: CreateTableInput): void {
  if (!input.name.trim() || input.name.length > 80) {
    throw new DomainError("VALIDATION_ERROR", "Masa adı geçersiz.", { httpStatus: 400 });
  }
  if (!Number.isSafeInteger(input.tableNumber) || input.tableNumber < 1) {
    throw new DomainError("VALIDATION_ERROR", "Masa numarası geçersiz.", { httpStatus: 400 });
  }
  if (!Number.isSafeInteger(input.seats) || input.seats < 1 || input.seats > 100) {
    throw new DomainError("VALIDATION_ERROR", "Kapasite 1 ile 100 arasinda olmalidir.", {
      httpStatus: 400,
    });
  }
}

export class TableService {
  constructor(
    private readonly repository: TableRepository,
    private readonly tokenCodec: TableTokenCodec,
  ) {}

  async validateToken(rawToken: string): Promise<ValidatedTableSession> {
    let tokenHash: string;
    try {
      tokenHash = this.tokenCodec.hash(rawToken);
    } catch {
      throw invalidTableToken();
    }

    const record = await this.repository.findSessionByTokenHash(tokenHash);
    if (
      !record ||
      record.qrTokenHash !== tokenHash ||
      !this.tokenCodec.verify(rawToken, record.qrTokenHash)
    ) {
      throw invalidTableToken();
    }
    if (!record.restaurantIsActive || !record.tableIsActive || record.qrTokenRevokedAt) {
      throw new DomainError("TABLE_INACTIVE", "Masa şu anda kullanılamıyor.", {
        httpStatus: 403,
      });
    }

    return {
      restaurant: {
        id: record.restaurantId,
        name: record.restaurantName,
        slug: record.restaurantSlug,
        currency: record.currency,
        timezone: record.timezone,
      },
      table: {
        id: record.id,
        name: record.name,
        tableNumber: record.tableNumber,
        seats: record.seats,
        accessVersion: record.qrTokenVersion,
      },
    };
  }

  async createTableWithToken(
    principal: RestaurantPrincipal | null | undefined,
    input: CreateTableInput,
  ): Promise<{ readonly table: ManagedTableResult; readonly rawToken: string }> {
    const actor = requireTableManager(principal, input.restaurantId);
    validateCreateInput(input);
    const generated = this.tokenCodec.generate();
    const table = await this.repository.createWithAudit({
      restaurantId: input.restaurantId,
      actorUserId: actor.userId,
      name: input.name.trim(),
      tableNumber: input.tableNumber,
      seats: input.seats,
      qrTokenHash: generated.tokenHash,
      audit: input.audit,
    });
    if (!table) throw internalError();
    return { table: managedTableDto(table), rawToken: generated.rawToken };
  }

  async rotateToken(
    principal: RestaurantPrincipal | null | undefined,
    input: ChangeTableTokenInput,
  ): Promise<{ readonly table: ManagedTableResult; readonly rawToken: string }> {
    const actor = requireTableManager(principal, input.restaurantId);
    const generated = this.tokenCodec.generate();
    const table = await this.repository.rotateTokenWithAudit({
      restaurantId: input.restaurantId,
      tableId: input.tableId,
      actorUserId: actor.userId,
      qrTokenHash: generated.tokenHash,
      audit: input.audit,
    });
    if (!table) {
      throw new DomainError("NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
    }
    return { table: managedTableDto(table), rawToken: generated.rawToken };
  }

  async revokeToken(
    principal: RestaurantPrincipal | null | undefined,
    input: ChangeTableTokenInput,
  ): Promise<ManagedTableResult> {
    const actor = requireTableManager(principal, input.restaurantId);
    const table = await this.repository.revokeTokenWithAudit({
      restaurantId: input.restaurantId,
      tableId: input.tableId,
      actorUserId: actor.userId,
      audit: input.audit,
    });
    if (!table) {
      throw new DomainError("NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
    }
    return managedTableDto(table);
  }

  async updateTable(
    principal: RestaurantPrincipal | null | undefined,
    input: UpdateTableInput,
  ): Promise<ManagedTableResult> {
    const actor = requireTableManager(principal, input.restaurantId);
    if (input.name !== undefined && !input.name.trim()) {
      throw new DomainError("VALIDATION_ERROR", "Masa adı boş olamaz.", { httpStatus: 400 });
    }
    const table = await this.repository.updateWithAudit({
      restaurantId: input.restaurantId,
      tableId: input.tableId,
      actorUserId: actor.userId,
      name: input.name?.trim(),
      seats: input.seats,
      isActive: input.isActive,
      audit: input.audit,
    });
    if (!table) {
      throw new DomainError("NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
    }
    return managedTableDto(table);
  }
}
