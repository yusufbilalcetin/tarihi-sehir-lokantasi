import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { inventoryItems, staffProfiles, stockMovements, warehouses } from "@/db/schema";
import { adminRead, parseParams } from "@/lib/api/admin-route";
import { DomainError } from "@/lib/api/domain-error";

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  return adminRead("api.admin.erp.inventory.detail", async ({ principal }) => {
    const { itemId: rawItemId } = await context.params;
    const itemId = parseParams(rawItemId, z.uuid(), "Stok kalemi kimliği geçersiz.");
    const page = Math.max(1, Number(new URL(request.url).searchParams.get("page") ?? 1));
    const pageSize = 50;
    const db = getDb();
    const [item] = await db.select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, baseUnit: inventoryItems.baseUnit, reorderLevel: inventoryItems.reorderLevel, negativeStockPolicy: inventoryItems.negativeStockPolicy, isActive: inventoryItems.isActive })
      .from(inventoryItems).where(and(eq(inventoryItems.restaurantId, principal.restaurantId), eq(inventoryItems.id, itemId))).limit(1);
    if (!item) throw new DomainError("NOT_FOUND", "Stok kalemi bulunamadı.", { httpStatus: 404 });
    const [balances, movements] = await Promise.all([
      db.select({ warehouseId: warehouses.id, warehouse: warehouses.name, quantity: sql<string>`coalesce(sum(${stockMovements.quantityDelta}),0)::numeric(18,6)` })
        .from(warehouses).leftJoin(stockMovements, and(eq(stockMovements.restaurantId, warehouses.restaurantId), eq(stockMovements.warehouseId, warehouses.id), eq(stockMovements.inventoryItemId, itemId)))
        .where(and(eq(warehouses.restaurantId, principal.restaurantId), eq(warehouses.isActive, true))).groupBy(warehouses.id).orderBy(asc(warehouses.name)),
      db.select({ id: stockMovements.id, occurredAt: stockMovements.occurredAt, warehouse: warehouses.name, movementType: stockMovements.movementType, quantityDelta: stockMovements.quantityDelta, unitCost: stockMovements.unitCost, sourceType: stockMovements.sourceType, reference: stockMovements.sourceId, staff: staffProfiles.name, reason: stockMovements.reason, total: sql<number>`count(*) over()::int` })
        .from(stockMovements).innerJoin(warehouses, and(eq(warehouses.restaurantId, stockMovements.restaurantId), eq(warehouses.id, stockMovements.warehouseId)))
        .leftJoin(staffProfiles, and(eq(staffProfiles.restaurantId, stockMovements.restaurantId), eq(staffProfiles.id, stockMovements.actorStaffId)))
        .where(and(eq(stockMovements.restaurantId, principal.restaurantId), eq(stockMovements.inventoryItemId, itemId)))
        .orderBy(sql`${stockMovements.occurredAt} desc`, sql`${stockMovements.id} desc`).limit(pageSize).offset((page - 1) * pageSize),
    ]);
    return { item, balances, movements: movements.map(({ total: _total, ...movement }) => movement), pagination: { page, pageSize, total: movements[0]?.total ?? 0 } };
  });
}
