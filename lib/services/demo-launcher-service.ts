import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { restaurantTables, restaurants } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { deriveTableQrLink } from "@/lib/security/qr-link-token.server";

/**
 * The prototype table launcher.
 *
 * Real guests scan the QR code printed on their table. This exists only so a
 * demo can be driven from a laptop, and it takes the same road they do: it
 * mints a genuine QR credential through the normal rotation path and then
 * hands the browser a normal `/menu/<token>` URL. The proxy still validates
 * that token, still issues the signed HttpOnly session, still binds it to the
 * table's access version, and still expires it on the usual schedule.
 *
 * It stores no raw token and mints nothing: the address it hands over is the
 * table's current QR link, re-derived on demand, so demoing a table neither
 * rotates its credential nor voids the code printed on it.
 */

export function demoLauncherDisabledError(): DomainError {
  return new DomainError("NOT_FOUND", "Demo masa seçici bu ortamda kapalı.", {
    httpStatus: 404,
  });
}

export interface DemoTable {
  readonly id: string;
  readonly name: string;
  readonly tableNumber: number;
  readonly seats: number;
  /** Operational status straight from the table row; never invented. */
  readonly status: string;
}

export interface DemoTableList {
  /** Identity only. The restaurant's internal id stays on the server. */
  readonly restaurant: { readonly name: string; readonly slug: string };
  readonly tables: readonly DemoTable[];
}

export class DemoLauncherService {
  constructor(private readonly db: Database = getDb()) {}

  /**
   * The restaurant the demo runs against. Resolved on the server from
   * configuration or, failing that, the only restaurant that exists — never
   * from anything the browser sent.
   */
  private async resolveRestaurant(): Promise<{ id: string; name: string; slug: string }> {
    const slug = process.env.DEMO_RESTAURANT_SLUG?.trim();
    const rows = await this.db
      .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
      .from(restaurants)
      .where(
        slug
          ? and(eq(restaurants.slug, slug), eq(restaurants.isActive, true))
          : eq(restaurants.isActive, true),
      )
      .orderBy(asc(restaurants.createdAt))
      .limit(2);

    if (rows.length === 0) {
      throw new DomainError("NOT_FOUND", "Demo restoranı bulunamadı.", { httpStatus: 404 });
    }
    // Without an explicit slug the launcher only guesses when there is nothing
    // to guess between.
    if (!slug && rows.length > 1) {
      throw new DomainError(
        "CONFLICT",
        "Birden fazla restoran var; DEMO_RESTAURANT_SLUG tanımlayın.",
        { httpStatus: 409 },
      );
    }
    return rows[0];
  }

  async listTables(): Promise<DemoTableList> {
    const restaurant = await this.resolveRestaurant();
    const rows = await this.db
      .select({
        id: restaurantTables.id,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        seats: restaurantTables.seats,
        status: restaurantTables.currentStatus,
      })
      .from(restaurantTables)
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurant.id),
          eq(restaurantTables.isActive, true),
          // A revoked QR is a table that is deliberately out of service.
          isNull(restaurantTables.qrTokenRevokedAt),
        ),
      )
      .orderBy(asc(restaurantTables.tableNumber));

    return {
      restaurant: { name: restaurant.name, slug: restaurant.slug },
      tables: rows.map((row) => ({
        id: row.id,
        name: row.name,
        tableNumber: row.tableNumber,
        seats: row.seats,
        status: row.status,
      })),
    };
  }

  /**
   * Returns a working `/menu/<token>` path for one active table.
   *
   * It re-derives the table's current QR link — the same string printed on the
   * table's card — instead of minting a credential. Previously it rotated the
   * token whenever this process had not already minted one, which quietly
   * invalidated the printed card on every cold start; deriving costs nothing
   * and changes nothing.
   */
  async menuPathForTable(tableId: string): Promise<{
    readonly path: string;
    readonly table: DemoTable;
  }> {
    const restaurant = await this.resolveRestaurant();
    const [table] = await this.db
      .select({
        id: restaurantTables.id,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        seats: restaurantTables.seats,
        status: restaurantTables.currentStatus,
        qrTokenVersion: restaurantTables.qrTokenVersion,
        revokedAt: restaurantTables.qrTokenRevokedAt,
      })
      .from(restaurantTables)
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurant.id),
          eq(restaurantTables.id, tableId),
          eq(restaurantTables.isActive, true),
        ),
      )
      .limit(1);
    // A table of another restaurant, an inactive one and one that does not
    // exist all answer the same way.
    if (!table || table.revokedAt) {
      throw new DomainError("NOT_FOUND", "Masa bulunamadı.", { httpStatus: 404 });
    }

    const token = deriveTableQrLink({
      restaurantSlug: restaurant.slug,
      tableNumber: table.tableNumber,
      accessVersion: table.qrTokenVersion,
    });

    return {
      path: `/menu/${token}`,
      table: {
        id: table.id,
        name: table.name,
        tableNumber: table.tableNumber,
        seats: table.seats,
        status: table.status,
      },
    };
  }
}
