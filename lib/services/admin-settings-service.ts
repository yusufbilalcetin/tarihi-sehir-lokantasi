import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { auditLogs, restaurantSettings } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import type { StaffPrincipal } from "@/lib/auth/foundation";

export interface RestaurantSettingsResult {
  readonly menuEnabled: boolean;
  readonly orderingEnabled: boolean;
  readonly waiterCallEnabled: boolean;
  readonly billRequestEnabled: boolean;
  readonly introEnabled: boolean;
  readonly waiterApprovalRequired: boolean;
  readonly customerNotesEnabled: boolean;
  readonly menuImagesEnabled: boolean;
  readonly serviceFeeRate: string;
  readonly taxRate: string;
  readonly maxItemQuantity: number;
  readonly orderNotesMaxLength: number;
  readonly waiterCallCooldownSeconds: number;
  readonly version: number;
}

export type RestaurantSettingsUpdate = Partial<Omit<RestaurantSettingsResult, "version">>;

const SELECTION = {
  menuEnabled: restaurantSettings.menuEnabled,
  orderingEnabled: restaurantSettings.orderingEnabled,
  waiterCallEnabled: restaurantSettings.waiterCallEnabled,
  billRequestEnabled: restaurantSettings.billRequestEnabled,
  introEnabled: restaurantSettings.introEnabled,
  waiterApprovalRequired: restaurantSettings.waiterApprovalRequired,
  customerNotesEnabled: restaurantSettings.customerNotesEnabled,
  menuImagesEnabled: restaurantSettings.menuImagesEnabled,
  serviceFeeRate: restaurantSettings.serviceFeeRate,
  taxRate: restaurantSettings.taxRate,
  maxItemQuantity: restaurantSettings.maxItemQuantity,
  orderNotesMaxLength: restaurantSettings.orderNotesMaxLength,
  waiterCallCooldownSeconds: restaurantSettings.waiterCallCooldownSeconds,
  version: restaurantSettings.version,
} as const;

function definedOnly<TValue extends Record<string, unknown>>(value: TValue): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as TValue;
}

export class AdminSettingsService {
  constructor(private readonly db: Database = getDb()) {}

  async get(principal: StaffPrincipal): Promise<RestaurantSettingsResult> {
    const rows = await this.db
      .select(SELECTION)
      .from(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, principal.restaurantId))
      .limit(1);
    const settings = rows[0];
    if (!settings) {
      throw new DomainError("NOT_FOUND", "Restoran ayarları bulunamadı.", { httpStatus: 404 });
    }
    return settings;
  }

  async update(
    principal: StaffPrincipal,
    update: RestaurantSettingsUpdate,
    requestId?: string,
  ): Promise<RestaurantSettingsResult> {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select(SELECTION)
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, principal.restaurantId))
        .for("update")
        .limit(1);
      if (!current) {
        throw new DomainError("NOT_FOUND", "Restoran ayarları bulunamadı.", { httpStatus: 404 });
      }

      const [updated] = await transaction
        .update(restaurantSettings)
        .set({
          ...definedOnly(update),
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(restaurantSettings.restaurantId, principal.restaurantId),
            eq(restaurantSettings.version, current.version),
          ),
        )
        .returning(SELECTION);
      if (!updated) {
        throw new DomainError("CONFLICT", "Ayarlar başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action: "settings.updated",
        entityType: "RESTAURANT_SETTINGS",
        entityId: principal.restaurantId,
        oldValue: { ...current },
        newValue: { ...updated },
        requestId,
      });

      return updated;
    });
  }
}
