import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { restaurantTables, restaurants, staffProfiles } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { DrizzleTableRepository } from "@/lib/repositories/drizzle-table-repository";
import {
  generateTableQrToken,
  hashTableQrToken,
  verifyTableQrToken,
} from "@/lib/security/qr-token.server";
import { TableService } from "@/lib/services/table-service";

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
 * Two things it deliberately does not do: store a raw token anywhere, and mint
 * a new one on every click. The token it mints is kept in this process's memory
 * and re-verified against the stored hash before reuse, so repeated demos of
 * the same table neither rotate the credential nor invalidate a live session.
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

/**
 * Raw tokens minted by this launcher, by table id. Process memory only: it is
 * lost on restart (which simply costs one more rotation) and never written
 * anywhere.
 */
const mintedTokens = new Map<string, string>();

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
   * The token is reused while it still verifies against the stored hash, so a
   * second demo of the same table changes nothing; otherwise a fresh one is
   * minted through the ordinary rotation path and only its hash is stored.
   */
  async menuPathForTable(tableId: string): Promise<{
    readonly path: string;
    readonly table: DemoTable;
    readonly rotated: boolean;
  }> {
    const restaurant = await this.resolveRestaurant();
    const [table] = await this.db
      .select({
        id: restaurantTables.id,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        seats: restaurantTables.seats,
        status: restaurantTables.currentStatus,
        qrTokenHash: restaurantTables.qrTokenHash,
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

    const cached = mintedTokens.get(table.id);
    if (cached && verifyTableQrToken(cached, table.qrTokenHash)) {
      return {
        path: `/menu/${cached}`,
        table: {
          id: table.id,
          name: table.name,
          tableNumber: table.tableNumber,
          seats: table.seats,
          status: table.status,
        },
        rotated: false,
      };
    }

    const service = new TableService(new DrizzleTableRepository(this.db), {
      generate: generateTableQrToken,
      hash: hashTableQrToken,
      verify: verifyTableQrToken,
    });
    // Rotation is an audited action, so it is attributed to the restaurant's
    // own administrator rather than to nobody — and the audit says the demo
    // launcher was the source. Without an administrator it simply does not run.
    const [administrator] = await this.db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.restaurantId, restaurant.id),
          eq(staffProfiles.role, "ADMIN"),
          eq(staffProfiles.isActive, true),
          isNull(staffProfiles.deletedAt),
        ),
      )
      .limit(1);
    if (!administrator) {
      throw new DomainError("CONFLICT", "Demo için yönetici hesabı gerekiyor.", {
        httpStatus: 409,
      });
    }
    const rotated = await service.rotateToken(
      {
        userId: administrator.id,
        restaurantId: restaurant.id,
        role: "ADMIN",
        isActive: true,
      },
      { restaurantId: restaurant.id, tableId: table.id },
    );
    mintedTokens.set(table.id, rotated.rawToken);

    return {
      path: `/menu/${rotated.rawToken}`,
      table: {
        id: table.id,
        name: table.name,
        tableNumber: table.tableNumber,
        seats: table.seats,
        status: table.status,
      },
      rotated: true,
    };
  }
}
