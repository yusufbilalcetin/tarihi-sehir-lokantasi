import { createHash } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  categories as mockCategories,
  orders as mockOrders,
  products as mockProducts,
  restaurantTables as mockTables,
  staffUsers as mockStaff,
  waiterCalls as mockWaiterCalls,
} from "./seed-data";
import { generateQrToken } from "../lib/security/qr-token";
import { parseServerEnvironment } from "../lib/env/validation";

import {
  categories,
  kitchenTickets,
  orderEvents,
  orderItems,
  orders,
  products,
  restaurantCounters,
  restaurantSettings,
  restaurants,
  restaurantTables,
  staffProfiles,
  waiterCalls,
  type JsonObject,
} from "./schema";

loadEnvConfig(process.cwd(), true);

const SEED_RESTAURANT_SLUG = "tarihi-sehir-lokantasi";
const SEED_DATE = "2026-08-11";

function deterministicUuid(kind: string, sourceId: string): string {
  const bytes = createHash("sha256")
    .update(`tarihi-sehir-lokantasi:development-seed:${kind}:${sourceId}`)
    .digest()
    .subarray(0, 16);

  // RFC 9562 UUIDv8 marks application-defined deterministic UUIDs without
  // claiming that this SHA-256 derivation is UUIDv5.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function money(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`[Database seed] Invalid money fixture: ${String(value)}`);
  }
  return value.toFixed(2);
}

function atSeedTime(time: string, offsetMinutes = 0): Date {
  const base = new Date(`${SEED_DATE}T${time}:00+03:00`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`[Database seed] Invalid time fixture: ${time}`);
  }
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

const orderStatusMap = {
  pending: "NEW",
  confirmed: "CONFIRMED",
  preparing: "PREPARING",
  ready: "READY",
  served: "SERVED",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
} as const;

const tableStatusMap = {
  available: "AVAILABLE",
  occupied: "OCCUPIED",
  ordering: "ORDERING",
  waiting: "WAITING",
  dining: "DINING",
  "waiter-call": "WAITER_CALL",
  "bill-requested": "BILL_REQUESTED",
  cleaning: "CLEANING",
  inactive: "INACTIVE",
} as const;

const staffRoleMap = {
  ADMIN: "ADMIN",
  Garson: "WAITER",
  "Şef Garson": "MANAGER",
  Mutfak: "KITCHEN",
  Kasa: "CASHIER",
} as const;

const callStatusMap = {
  open: "OPEN",
  assigned: "ACKNOWLEDGED",
  resolved: "RESOLVED",
} as const;

const eventTypeByStatus = {
  pending: "ORDER_CREATED",
  confirmed: "ORDER_CONFIRMED",
  preparing: "ORDER_PREPARING",
  ready: "ORDER_READY",
  served: "ORDER_SERVED",
  completed: "ORDER_COMPLETED",
  cancelled: "ORDER_CANCELLED",
} as const;

function eventTypeForStatus(status: keyof typeof orderStatusMap) {
  return eventTypeByStatus[status];
}

function seededEmail(name: string): string {
  const local = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${local}@seed.invalid`;
}

async function seed() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "[Database seed] Refusing to run unless NODE_ENV=development.",
    );
  }
  if (process.env.ALLOW_DATABASE_SEED !== "true") {
    throw new Error(
      "[Database seed] Set ALLOW_DATABASE_SEED=true explicitly for this development-only operation.",
    );
  }

  const environment = parseServerEnvironment(process.env, ["database", "qr-token"]);
  const databaseUrl = environment.databaseUrl!;
  const qrTokenPepper = environment.qrTokenPepper!;

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  const db = drizzle(client);

  try {
    const seeded = await db.transaction(async (tx) => {
      const [restaurant] = await tx
        .insert(restaurants)
        .values({
          id: deterministicUuid("restaurant", SEED_RESTAURANT_SLUG),
          name: "Tarihi Şehir Lokantası",
          slug: SEED_RESTAURANT_SLUG,
          logoUrl: "/images/brand/wordmark-transparent.png",
          phone: "0224 224 18 42",
          address: "Kayhan Mah. Ünlü Cad. No: 18, Osmangazi / Bursa",
          currency: "TRY",
          timezone: "Europe/Istanbul",
          defaultLocale: "tr-TR",
          isActive: true,
        })
        .onConflictDoUpdate({
          target: restaurants.slug,
          set: {
            name: sql`excluded.name`,
            logoUrl: sql`excluded.logo_url`,
            phone: sql`excluded.phone`,
            address: sql`excluded.address`,
            currency: sql`excluded.currency`,
            timezone: sql`excluded.timezone`,
            defaultLocale: sql`excluded.default_locale`,
            isActive: true,
          },
        })
        .returning({ id: restaurants.id });

      if (!restaurant) throw new Error("[Database seed] Restaurant upsert failed.");
      const restaurantId = restaurant.id;

      await tx
        .insert(restaurantSettings)
        .values({ restaurantId })
        .onConflictDoNothing({ target: restaurantSettings.restaurantId });

      const categoryRows = await tx
        .insert(categories)
        .values(
          mockCategories.map((category) => ({
            id: deterministicUuid("category", category.id),
            restaurantId,
            name: category.name,
            slug: category.slug,
            sortOrder: category.sortOrder,
            imageUrl: category.image,
            isActive: category.active,
          })),
        )
        .onConflictDoUpdate({
          target: [categories.restaurantId, categories.slug],
          set: {
            name: sql`excluded.name`,
            imageUrl: sql`excluded.image_url`,
            sortOrder: sql`excluded.sort_order`,
            isActive: sql`excluded.is_active`,
            deletedAt: null,
          },
        })
        .returning({ id: categories.id, slug: categories.slug });
      const categoryIdBySlug = new Map(
        categoryRows.map((category) => [category.slug, category.id]),
      );
      const categorySlugByFixtureId = new Map(
        mockCategories.map((category) => [category.id, category.slug]),
      );

      const productRows = await tx
        .insert(products)
        .values(
          mockProducts.map((product, index) => {
            const categorySlug = categorySlugByFixtureId.get(product.categoryId);
            const categoryId = categorySlug
              ? categoryIdBySlug.get(categorySlug)
              : undefined;
            if (!categoryId) {
              throw new Error(
                `[Database seed] Missing category for product fixture ${product.id}.`,
              );
            }

            const slug = product.id;
            return {
              id: deterministicUuid("product", product.id),
              restaurantId,
              categoryId,
              name: product.name,
              slug,
              description: product.description,
              price: money(product.price),
              imageUrl: product.image,
              weightLabel: product.weight,
              isActive: product.status !== "inactive",
              isAvailable: product.status !== "sold-out",
              isFeatured: product.featured ?? false,
              isSpicy: product.tags.includes("Acılı"),
              isVegetarian:
                product.tags.includes("Vejetaryen") ||
                product.tags.includes("Vegan"),
              allergens: product.allergens,
              tags: product.tags,
              sortOrder: index + 1,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [products.restaurantId, products.slug],
          set: {
            categoryId: sql`excluded.category_id`,
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            price: sql`excluded.price`,
            imageUrl: sql`excluded.image_url`,
            weightLabel: sql`excluded.weight_label`,
            isActive: sql`excluded.is_active`,
            isAvailable: sql`excluded.is_available`,
            isFeatured: sql`excluded.is_featured`,
            isSpicy: sql`excluded.is_spicy`,
            isVegetarian: sql`excluded.is_vegetarian`,
            allergens: sql`excluded.allergens`,
            tags: sql`excluded.tags`,
            sortOrder: sql`excluded.sort_order`,
            deletedAt: null,
          },
        })
        .returning({ id: products.id, slug: products.slug });
      const productIdByFixtureId = new Map(
        productRows.map((product) => [product.slug, product.id]),
      );

      const staffRows = mockStaff.map((staff) => ({
        id: deterministicUuid("staff", staff.id),
        authUserId: null,
        restaurantId,
        loginIdentifier: staff.code,
        name: staff.name,
        email: seededEmail(staff.name),
        phone: staff.phone,
        role: staffRoleMap[staff.role],
        isActive: staff.active,
      }));
      await tx
        .insert(staffProfiles)
        .values(staffRows)
        .onConflictDoUpdate({
          target: staffProfiles.id,
          set: {
            name: sql`excluded.name`,
            loginIdentifier: sql`excluded.login_identifier`,
            email: sql`excluded.email`,
            phone: sql`excluded.phone`,
            role: sql`excluded.role`,
            isActive: sql`excluded.is_active`,
            deletedAt: null,
          },
        });
      const staffIdByFirstName = new Map(
        staffRows.map((staff) => [staff.name.split(" ")[0], staff.id]),
      );

      const tableRows = await tx
        .insert(restaurantTables)
        .values(
          mockTables.map((table) => {
            // The raw token exists only inside this expression and is discarded.
            // Never print it: production QR rotation explicitly returns it once.
            const { tokenHash } = generateQrToken(qrTokenPepper);
            return {
              id: deterministicUuid("table", table.id),
              restaurantId,
              name: table.name,
              tableNumber: Number(table.id),
              seats: table.seats,
              qrTokenHash: tokenHash,
              qrTokenVersion: 1,
              // Seeded raw tokens are deliberately discarded, so these rows
              // start revoked. Use the admin rotate-token flow to obtain each
              // raw token exactly once before generating a usable QR code.
              qrTokenRevokedAt: new Date(),
              isActive: table.qrAvailable,
              currentStatus: tableStatusMap[table.status],
            };
          }),
        )
        .onConflictDoUpdate({
          target: [restaurantTables.restaurantId, restaurantTables.tableNumber],
          set: {
            name: sql`excluded.name`,
            seats: sql`excluded.seats`,
            isActive: sql`excluded.is_active`,
            currentStatus: sql`excluded.current_status`,
          },
        })
        .returning({
          id: restaurantTables.id,
          tableNumber: restaurantTables.tableNumber,
        });
      const tableIdByFixtureId = new Map(
        tableRows.map((table) => [String(table.tableNumber), table.id]),
      );

      const maxSequence = mockOrders.reduce(
        (maximum, order) =>
          Math.max(maximum, Number(order.orderNumber.replace(/\D/g, ""))),
        0,
      );
      await tx
        .insert(restaurantCounters)
        .values({
          restaurantId,
          counterName: "ORDER",
          currentValue: BigInt(maxSequence),
        })
        .onConflictDoUpdate({
          target: [
            restaurantCounters.restaurantId,
            restaurantCounters.counterName,
          ],
          set: {
            currentValue: sql`greatest(${restaurantCounters.currentValue}, excluded.current_value)`,
          },
        });

      const orderRows = mockOrders.map((order) => {
        const tableId = tableIdByFixtureId.get(order.tableId ?? "");
        if (!tableId) {
          throw new Error(
            `[Database seed] Missing table for order fixture ${order.id}.`,
          );
        }
        const orderSequence = Number(order.orderNumber.replace(/\D/g, ""));
        const created = atSeedTime(order.createdAt);
        const status = orderStatusMap[order.status];
        const subtotal = order.items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        );
        if (subtotal !== order.total) {
          throw new Error(
            `[Database seed] Order ${order.orderNumber} total mismatch: fixture=${order.total}, item snapshots=${subtotal}.`,
          );
        }
        return {
          id: deterministicUuid("order", order.id),
          restaurantId,
          tableId,
          orderSequence: BigInt(orderSequence),
          orderNumber: `ORD-${orderSequence}`,
          status,
          subtotal: money(subtotal),
          discountTotal: "0.00",
          serviceChargeTotal: "0.00",
          taxTotal: "0.00",
          total: money(subtotal),
          notes: order.note,
          createdByType: "CUSTOMER" as const,
          confirmedAt: status === "NEW" ? null : new Date(created.getTime() + 60_000),
          preparingAt:
            ["PREPARING", "READY", "SERVED", "COMPLETED"].includes(status)
              ? new Date(created.getTime() + 2 * 60_000)
              : null,
          readyAt:
            ["READY", "SERVED", "COMPLETED"].includes(status)
              ? new Date(created.getTime() + 8 * 60_000)
              : null,
          servedAt:
            ["SERVED", "COMPLETED"].includes(status)
              ? new Date(created.getTime() + 10 * 60_000)
              : null,
          closedAt:
            status === "COMPLETED"
              ? new Date(created.getTime() + 45 * 60_000)
              : null,
          cancelledAt:
            status === "CANCELLED"
              ? new Date(created.getTime() + 2 * 60_000)
              : null,
          createdAt: created,
          updatedAt: created,
        };
      });
      await tx
        .insert(orders)
        .values(orderRows)
        .onConflictDoNothing({ target: [orders.restaurantId, orders.orderNumber] });

      const persistedOrders = await tx
        .select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.restaurantId, restaurantId));
      const orderIdByNumber = new Map(
        persistedOrders.map((order) => [order.orderNumber, order.id]),
      );

      const itemRows = mockOrders.flatMap((order) => {
        const orderNumber = `ORD-${Number(order.orderNumber.replace(/\D/g, ""))}`;
        const orderId = orderIdByNumber.get(orderNumber);
        if (!orderId) {
          throw new Error(
            `[Database seed] Missing persisted order ${orderNumber}.`,
          );
        }
        return order.items.map((item, index) => {
          const productId = productIdByFixtureId.get(item.productId);
          if (!productId) {
            throw new Error(
              `[Database seed] Missing product for item fixture ${item.id}.`,
            );
          }
          return {
            id: deterministicUuid("order-item", item.id),
            restaurantId,
            orderId,
            productId,
            productNameSnapshot: item.productName,
            unitPrice: money(item.unitPrice),
            quantity: item.quantity,
            lineTotal: money(item.unitPrice * item.quantity),
            notes: item.note,
            status:
              order.status === "cancelled"
                ? ("CANCELLED" as const)
                : order.status === "served" || order.status === "completed"
                  ? ("SERVED" as const)
                  : order.status === "ready"
                    ? ("READY" as const)
                    : order.status === "preparing"
                      ? ("PREPARING" as const)
                      : ("PENDING" as const),
            sortOrder: index + 1,
            createdAt: atSeedTime(order.createdAt),
            updatedAt: atSeedTime(order.createdAt),
          };
        });
      });
      await tx
        .insert(orderItems)
        .values(itemRows)
        .onConflictDoNothing({ target: orderItems.id });

      const ticketRows = mockOrders
        .filter((order) => ["pending", "preparing", "ready"].includes(order.status))
        .map((order) => {
          const orderNumber = `ORD-${Number(order.orderNumber.replace(/\D/g, ""))}`;
          const orderId = orderIdByNumber.get(orderNumber);
          if (!orderId) throw new Error(`[Database seed] Missing ${orderNumber}.`);
          const status =
            order.status === "pending"
              ? ("NEW" as const)
              : order.status === "preparing"
                ? ("PREPARING" as const)
                : ("READY" as const);
          const created = atSeedTime(order.createdAt);
          return {
            id: deterministicUuid("kitchen-ticket", order.id),
            restaurantId,
            orderId,
            status,
            preparationStartedAt:
              status === "NEW" ? null : new Date(created.getTime() + 2 * 60_000),
            readyAt:
              status === "READY" ? new Date(created.getTime() + 8 * 60_000) : null,
            createdAt: created,
            updatedAt: created,
          };
        });
      if (ticketRows.length) {
        await tx
          .insert(kitchenTickets)
          .values(ticketRows)
          .onConflictDoNothing({
            target: [kitchenTickets.restaurantId, kitchenTickets.orderId],
          });
      }

      const eventRows: Array<typeof orderEvents.$inferInsert> = mockOrders.flatMap((order) => {
        const orderNumber = `ORD-${Number(order.orderNumber.replace(/\D/g, ""))}`;
        const orderId = orderIdByNumber.get(orderNumber);
        if (!orderId) throw new Error(`[Database seed] Missing ${orderNumber}.`);
        const created = atSeedTime(order.createdAt);
        const basePayload: JsonObject = {
          source: "development_seed",
          orderNumber,
        };
        const createdEvent = {
          id: deterministicUuid("order-event-created", order.id),
          restaurantId,
          orderId,
          eventType: "ORDER_CREATED" as const,
          payload: basePayload,
          createdAt: created,
        };
        if (order.status === "pending") return [createdEvent];
        return [
          createdEvent,
          {
            id: deterministicUuid("order-event-current", order.id),
            restaurantId,
            orderId,
            eventType: eventTypeForStatus(order.status),
            payload: basePayload,
            createdAt: new Date(created.getTime() + 2 * 60_000),
          },
        ];
      });
      await tx
        .insert(orderEvents)
        .values(eventRows)
        .onConflictDoNothing({ target: orderEvents.id });

      const callRows = mockWaiterCalls.map((call) => {
        const tableId = tableIdByFixtureId.get(call.tableId);
        if (!tableId) {
          throw new Error(`[Database seed] Missing table for call ${call.id}.`);
        }
        const type =
          call.type === "Hesap istiyor"
            ? ("BILL_REQUEST" as const)
            : call.type === "Garson çağır"
              ? ("WAITER_CALL" as const)
              : ("OTHER" as const);
        return {
          id: deterministicUuid("waiter-call", call.id),
          restaurantId,
          tableId,
          type,
          requestLabel: call.type,
          status: callStatusMap[call.status],
          tableTokenVersion: 1,
          acknowledgedAt:
            call.status === "assigned" ? atSeedTime(call.createdAt, 1) : null,
          acknowledgedBy: call.assignedTo
            ? staffIdByFirstName.get(call.assignedTo)
            : null,
          resolvedAt:
            call.status === "resolved" ? atSeedTime(call.createdAt, 2) : null,
          createdAt: atSeedTime(call.createdAt),
          updatedAt: atSeedTime(call.createdAt),
        };
      });
      await tx
        .insert(waiterCalls)
        .values(callRows)
        .onConflictDoNothing({ target: waiterCalls.id });

      return {
        restaurantId,
        categories: categoryRows.length,
        products: productRows.length,
        tables: tableRows.length,
        staff: staffRows.length,
        orders: orderRows.length,
        orderItems: itemRows.length,
        waiterCalls: callRows.length,
      };
    });

    // Safe operational summary only. QR tokens, hashes, credentials and secrets
    // are deliberately never included in seed logs.
    console.info("[Database seed] Development fixtures are ready.", seeded);
  } finally {
    await client.end({ timeout: 5 });
  }
}

seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown seed error";
  console.error(message);
  process.exitCode = 1;
});
