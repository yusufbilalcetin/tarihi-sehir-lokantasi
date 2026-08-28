export interface TableSessionRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly qrTokenHash: string;
  readonly qrTokenVersion: number;
  readonly qrTokenRevokedAt: Date | null;
  readonly tableIsActive: boolean;
  readonly restaurantName: string;
  readonly restaurantSlug: string;
  readonly restaurantIsActive: boolean;
  readonly currency: string;
  readonly timezone: string;
}
export interface ManagedTableRecord {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly qrTokenVersion: number;
  readonly qrTokenRevokedAt: Date | null;
  readonly isActive: boolean;
}

export interface AuditRequestContext {
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface CreateManagedTableRecordInput {
  readonly restaurantId: string;
  readonly actorUserId: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  readonly qrTokenHash: string;
  readonly audit?: AuditRequestContext;
}

export interface ChangeTableTokenRecordInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly actorUserId: string;
  readonly qrTokenHash?: string;
  readonly audit?: AuditRequestContext;
}

export interface UpdateManagedTableRecordInput {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly actorUserId: string;
  readonly name?: string;
  readonly tableNumber?: number;
  readonly seats?: number;
  readonly isActive?: boolean;
  readonly audit?: AuditRequestContext;
}

export interface TableRepository {
  findSessionByTokenHash(tokenHash: string): Promise<TableSessionRecord | null>;
  /**
   * Resolves the row a derived QR link points at. The pair is unique
   * (`restaurants.slug`, then `restaurant_tables_restaurant_number_key`), so
   * this is a keyed read rather than a scan.
   */
  findSessionByTableRef(
    restaurantSlug: string,
    tableNumber: number,
  ): Promise<TableSessionRecord | null>;
  /** Every table of one restaurant, for re-deriving its QR links. */
  listSessionsForRestaurant(restaurantId: string): Promise<readonly TableSessionRecord[]>;
  createWithAudit(input: CreateManagedTableRecordInput): Promise<ManagedTableRecord | null>;
  rotateTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null>;
  pauseQrAccessWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null>;
  resumeQrAccessWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null>;
  revokeTokenWithAudit(input: ChangeTableTokenRecordInput): Promise<ManagedTableRecord | null>;
  updateWithAudit(input: UpdateManagedTableRecordInput): Promise<ManagedTableRecord | null>;
}
