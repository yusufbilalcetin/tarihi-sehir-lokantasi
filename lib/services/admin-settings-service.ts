import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { auditLogs, restaurants, restaurantSettings } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import type { StaffPrincipal } from "@/lib/auth/foundation";

/**
 * The restaurant's own details. Real columns on `restaurants` — they were never
 * missing, only unreachable: no admin endpoint wrote them, so the settings
 * screen showed a hardcoded name and a form that went nowhere.
 */
export interface RestaurantProfileResult {
  readonly name: string;
  readonly phone: string | null;
  readonly address: string | null;
  /** Set by the image pipeline, not by this endpoint; shown here, not edited. */
  readonly logoUrl: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly defaultLocale: string;
}

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
  readonly profile: RestaurantProfileResult;
}

/**
 * One save covers both tables, because to the operator it is one screen. The
 * profile columns stay on `restaurants` — copying them into a settings table
 * would give the restaurant's name two homes and a way to disagree with itself.
 */
export type RestaurantSettingsUpdate = Partial<
  Omit<RestaurantSettingsResult, "version" | "profile">
> &
  Partial<Pick<RestaurantProfileResult, "name" | "phone" | "address" | "currency" | "timezone" | "defaultLocale">> & {
    readonly expectedVersion?: number;
  };

const PROFILE_SELECTION = {
  name: restaurants.name,
  phone: restaurants.phone,
  address: restaurants.address,
  logoUrl: restaurants.logoUrl,
  currency: restaurants.currency,
  timezone: restaurants.timezone,
  defaultLocale: restaurants.defaultLocale,
} as const;

const PROFILE_FIELDS = [
  "name",
  "phone",
  "address",
  "currency",
  "timezone",
  "defaultLocale",
] as const;

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
    const [rows, profiles] = await Promise.all([
      this.db
        .select(SELECTION)
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, principal.restaurantId))
        .limit(1),
      this.db
        .select(PROFILE_SELECTION)
        .from(restaurants)
        .where(eq(restaurants.id, principal.restaurantId))
        .limit(1),
    ]);
    const settings = rows[0];
    const profile = profiles[0];
    if (!settings || !profile) {
      throw new DomainError("NOT_FOUND", "Restoran ayarları bulunamadı.", { httpStatus: 404 });
    }
    return { ...settings, profile };
  }

  async update(
    principal: StaffPrincipal,
    update: RestaurantSettingsUpdate,
    requestId?: string,
  ): Promise<RestaurantSettingsResult> {
    const { expectedVersion, ...fields } = update;
    // Split once, here: the profile lives on `restaurants`, the rest on
    // `restaurant_settings`, and neither table learns about the other's columns.
    const profileUpdate = definedOnly(
      Object.fromEntries(
        PROFILE_FIELDS.filter((key) => key in fields).map((key) => [key, fields[key]]),
      ),
    );
    const settingsUpdate = definedOnly(
      Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => !(PROFILE_FIELDS as readonly string[]).includes(key),
        ),
      ),
    );

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
      // The screen sends back the version it was showing. Without it the second
      // administrator to press Kaydet silently overwrites the first.
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw new DomainError(
          "CONFLICT",
          "Ayarlar siz düzenlerken başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.",
          { httpStatus: 409 },
        );
      }

      // Both tables move together or neither does: the version bump on the
      // settings row is what the profile write is protected by too.
      let profileBefore: Record<string, unknown> | null = null;
      if (Object.keys(profileUpdate).length > 0) {
        const [before] = await transaction
          .select(PROFILE_SELECTION)
          .from(restaurants)
          .where(eq(restaurants.id, principal.restaurantId))
          .for("update")
          .limit(1);
        if (!before) {
          throw new DomainError("NOT_FOUND", "Restoran bulunamadı.", { httpStatus: 404 });
        }
        profileBefore = { ...before };
        await transaction
          .update(restaurants)
          .set({ ...profileUpdate, updatedAt: new Date() })
          .where(eq(restaurants.id, principal.restaurantId));
      }

      const [updated] = await transaction
        .update(restaurantSettings)
        .set({
          ...settingsUpdate,
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

      const [profile] = await transaction
        .select(PROFILE_SELECTION)
        .from(restaurants)
        .where(eq(restaurants.id, principal.restaurantId))
        .limit(1);
      if (!profile) {
        throw new DomainError("NOT_FOUND", "Restoran bulunamadı.", { httpStatus: 404 });
      }

      await transaction.insert(auditLogs).values({
        restaurantId: principal.restaurantId,
        actorUserId: principal.userId,
        action: "settings.updated",
        entityType: "RESTAURANT_SETTINGS",
        entityId: principal.restaurantId,
        oldValue: { ...current, ...(profileBefore ?? {}) },
        newValue: { ...updated, ...(profileBefore ? { ...profile } : {}) },
        requestId,
      });

      return { ...updated, profile };
    });
  }
}
