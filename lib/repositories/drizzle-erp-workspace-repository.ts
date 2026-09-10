import "server-only";

import { addDays, formatDay, toLocalDay } from "@/lib/domain/report-range";
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  attendanceRecords,
  auditLogs,
  customerFeedback,
  fulfillmentRequests,
  inventoryItems,
  orders,
  payrollEntries,
  purchaseOrders,
  recipeIngredients,
  recipeVersions,
  reservations,
  staffSchedules,
  stockCountLines,
  stockCounts,
  stockMovements,
  supplierItems,
  suppliers,
} from "@/db/schema";
import { DomainError, validationError } from "@/lib/api/domain-error";
import {
  assertFulfillmentTransition,
  assertPurchaseTransition,
  assertRecipeLifecycleTransition,
  assertReservationTransition,
  boundWorkspaceRange,
  ERP_EXPORT_MAX_ROWS,
  ERP_UNIT_LABELS,
  ERP_RANGE_CLAMPED_NOTICE,
  normalizeWorkspacePage,
  stockTransferKeys,
  type ErpWorkspaceData,
  type ErpWorkspaceQuery,
  type FulfillmentWorkflowStatus,
  type PurchaseWorkflowStatus,
  type RecipeLifecycleStatus,
  type ReservationWorkflowStatus,
} from "@/lib/domain/erp-workspaces";
import { OPEN_ORDER_STATUSES } from "@/lib/domain/status";
import { convertQuantity, evaluateStockBalance, formatFixedDecimal, parseFixedDecimal, payrollNetPayable } from "@/lib/domain/erp";
import type { ErpWorkspaceRepository } from "@/lib/repositories/erp-workspace-repository";

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return Array.from(value as readonly Row[]);
}

function totalFrom(rows: readonly Row[]) {
  const raw = rows[0]?.full_count;
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function withoutCount(rows: readonly Row[]) {
  return rows.map(({ full_count: _count, ...row }) => row);
}

function dateValue(value: string | null, fallback: string) {
  return value ?? fallback;
}

export class DrizzleErpWorkspaceRepository implements ErpWorkspaceRepository {
  constructor(private readonly db: Database) {}

  private async executeRows(query: Parameters<Database["execute"]>[0]) {
    return asRows(await this.db.execute(query));
  }

  private async options(restaurantId: string, module: ErpWorkspaceQuery["module"]): Promise<Record<string, readonly Record<string, string>[]>> {
    if (module === "fulfillment") {
      // Only orders that are still open and not already spoken for: linking a
      // settled order would put a delivery behind a paid bill.
      const openOrders = await this.executeRows(sql`
        select o.id::text as value, o.order_number as label from orders o
        where o.restaurant_id=${restaurantId} and o.status::text in ${[...OPEN_ORDER_STATUSES]}
          and not exists (select 1 from fulfillment_requests fr where fr.restaurant_id=o.restaurant_id and fr.order_id=o.id)
        order by o.created_at desc limit 100`);
      return { openOrders: openOrders as Record<string, string>[] };
    }
    const needsInventory = ["inventory", "stock-movements", "stock-counts", "warehouses", "recipes", "waste", "suppliers", "purchasing", "costing", "production"].includes(module);
    const needsProducts = ["recipes", "costing", "production", "forecast", "menu-engineering", "popular"].includes(module);
    const needsSuppliers = ["suppliers", "purchasing", "payables"].includes(module);
    const needsStaff = ["attendance", "schedules", "payroll"].includes(module);
    const needsTables = module === "reservations";
    const needsRecipes = module === "production";
    const needsPurchaseLines = module === "purchasing";
    const [warehousesRows, inventoryRows, productRows, supplierRows, staffRows, tableRows, recipeRows, purchaseLineRows] = await Promise.all([
      needsInventory ? this.executeRows(sql`select id::text as value, name as label from warehouses where restaurant_id = ${restaurantId} and is_active order by name limit 200`) : [],
      needsInventory ? this.executeRows(sql`select id::text as value, name as label, base_unit::text as unit from inventory_items where restaurant_id = ${restaurantId} and is_active order by name limit 500`) : [],
      needsProducts ? this.executeRows(sql`select id::text as value, name as label from products where restaurant_id = ${restaurantId} and deleted_at is null order by name limit 500`) : [],
      needsSuppliers ? this.executeRows(sql`select id::text as value, name as label from suppliers where restaurant_id = ${restaurantId} and is_active order by name limit 300`) : [],
      needsStaff ? this.executeRows(sql`select id::text as value, name as label from staff_profiles where restaurant_id = ${restaurantId} and is_active and deleted_at is null order by name limit 300`) : [],
      needsTables ? this.executeRows(sql`select id::text as value, name as label from restaurant_tables where restaurant_id = ${restaurantId} and is_active order by table_number, name limit 300`) : [],
      needsRecipes ? this.executeRows(sql`select rv.id::text as value, (p.name || ' · v' || rv.version::text) as label, rv.product_id::text as product_id from recipe_versions rv join products p on p.restaurant_id=rv.restaurant_id and p.id=rv.product_id where rv.restaurant_id=${restaurantId} and rv.status='ACTIVE' order by p.name limit 500`) : [],
      needsPurchaseLines ? this.executeRows(sql`select poi.id::text as value, (po.order_number || ' · ' || i.name || ' · kalan ' || (poi.ordered_quantity-poi.received_quantity)::text || ' ' || poi.unit::text) as label, po.id::text as purchase_order_id, po.supplier_id::text as supplier_id, poi.inventory_item_id::text as inventory_item_id, poi.unit::text as unit, (poi.ordered_quantity-poi.received_quantity)::text as remaining from purchase_order_items poi join purchase_orders po on po.restaurant_id=poi.restaurant_id and po.id=poi.purchase_order_id join inventory_items i on i.restaurant_id=poi.restaurant_id and i.id=poi.inventory_item_id where poi.restaurant_id=${restaurantId} and po.status in ('SENT','PARTIALLY_RECEIVED') and poi.received_quantity<poi.ordered_quantity order by po.created_at desc limit 500`) : [],
    ]);
    return {
      warehouses: warehousesRows as Record<string, string>[],
      inventoryItems: inventoryRows as Record<string, string>[],
      products: productRows as Record<string, string>[],
      suppliers: supplierRows as Record<string, string>[],
      staff: staffRows as Record<string, string>[],
      tables: tableRows as Record<string, string>[],
      recipes: recipeRows as Record<string, string>[],
      purchaseOrderItems: purchaseLineRows as Record<string, string>[],
    };
  }

  async read(restaurantId: string, query: ErpWorkspaceQuery): Promise<ErpWorkspaceData> {
    // The screen's page size is capped at 100 by the query schema; the export
    // route is the only caller that asks for more, and this is its ceiling.
    const { page, pageSize, offset } = normalizeWorkspacePage(query.page, query.pageSize, ERP_EXPORT_MAX_ROWS);
    const search = query.search;
    const status = query.status;
    const category = query.category;
    const warehouseId = query.warehouseId;
    // The restaurant's calendar day, not UTC's. `toISOString()` here made
    // 00:00-02:59 in Istanbul — while a late service is still trading — default
    // every ERP list to yesterday and silently drop the current day's rows. The
    // sibling overview repository already carries this fix; the workspace did
    // not. `report-range` owns the offset so there is one place to change it.
    const now = new Date();
    const today = formatDay(toLocalDay(now));
    // The window is clamped here rather than in the query schema: a hand-edited
    // `dateFrom` of 1970-01-01 is a valid date, and only the server decides how
    // much history a single report is allowed to scan.
    const bounded = boundWorkspaceRange(
      dateValue(query.dateFrom, formatDay(addDays(toLocalDay(now), -30))),
      dateValue(query.dateTo, today),
    );
    const from = bounded.from;
    const to = bounded.to;
    let rows: Row[] = [];
    let notice: string | undefined = bounded.clamped ? ERP_RANGE_CLAMPED_NOTICE : undefined;

    // The filter options need the tenant and the module — never the rows — so
    // they travel alongside the row query instead of behind it. Awaiting them
    // afterwards cost a second round trip on every one of these screens, and at
    // this deployment's ~48 ms RTT that was measured at 94 ms versus 49 ms.
    const optionsPromise = this.options(restaurantId, query.module);
    // Marks the rejection handled so a failing row query cannot surface this as
    // an unhandled rejection; the original promise still throws when awaited.
    optionsPromise.catch(() => undefined);

    switch (query.module) {
      case "sales":
        // The same basis the finance summary uses — sum(orders.total) over
        // SERVED and COMPLETED — partitioned by channel, so the channel rows of
        // a day add up to that day's gross sales by construction.
        rows = await this.executeRows(sql`
          select (o.created_at at time zone 'Europe/Istanbul')::date::text as business_date, o.channel::text as channel,
            count(*)::int as order_count,
            sum(o.total)::numeric(14,2)::text as gross_sales,
            round(sum(o.total)/count(*), 2)::text as average_check,
            count(*) over()::int as full_count
          from orders o
          where o.restaurant_id=${restaurantId} and o.status in ('SERVED','COMPLETED')
            and o.created_at >= ${from}::date and o.created_at < (${to}::date + interval '1 day')
            and (${status}='' or o.channel::text=${status})
          group by 1, 2 order by 1 desc, 2 limit ${pageSize} offset ${offset}`);
        break;
      case "stock-movements":
        rows = await this.executeRows(sql`
          select sm.id::text, sm.occurred_at, i.name as inventory_item, i.base_unit as unit, w.name as warehouse,
            sm.movement_type, sm.quantity_delta::text, sm.unit_cost::numeric(14,2)::text as unit_cost,
            sm.reason, coalesce(sp.name, 'Sistem') as recorded_by, count(*) over()::int as full_count
          from stock_movements sm
          join inventory_items i on i.restaurant_id=sm.restaurant_id and i.id=sm.inventory_item_id
          join warehouses w on w.restaurant_id=sm.restaurant_id and w.id=sm.warehouse_id
          left join staff_profiles sp on sp.restaurant_id=sm.restaurant_id and sp.id=sm.actor_staff_id
          where sm.restaurant_id=${restaurantId}
            and sm.occurred_at >= ${from}::date and sm.occurred_at < (${to}::date + interval '1 day')
            and (${warehouseId}::uuid is null or sm.warehouse_id=${warehouseId}::uuid)
            and (${search}='' or i.name ilike ${`%${search}%`} or sm.reason ilike ${`%${search}%`})
            and (${status}='' or sm.movement_type::text=${status})
          order by sm.occurred_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "stock-counts":
        // The variance is read, never recomputed. `stock_count_lines` stores
        // the system quantity as it stood at the moment the count was
        // confirmed, written inside the same transaction that posted the
        // correction; recalculating a balance today would answer a different
        // question and call it history.
        rows = await this.executeRows(sql`
          select scl.id::text, sc.created_at as counted_at, sc.completed_at, sc.status,
            w.name as warehouse, i.name as inventory_item, i.base_unit as unit,
            scl.counted_quantity::text as counted_quantity,
            scl.expected_quantity::text as system_quantity,
            scl.variance_quantity::text as variance,
            coalesce(sp.name, 'Sistem') as counted_by,
            count(*) over()::int as full_count
          from stock_count_lines scl
          join stock_counts sc on sc.restaurant_id=scl.restaurant_id and sc.id=scl.stock_count_id
          join warehouses w on w.restaurant_id=sc.restaurant_id and w.id=sc.warehouse_id
          join inventory_items i on i.restaurant_id=scl.restaurant_id and i.id=scl.inventory_item_id
          left join staff_profiles sp on sp.restaurant_id=sc.restaurant_id and sp.id=sc.counted_by_staff_id
          where scl.restaurant_id=${restaurantId}
            and sc.created_at >= ${from}::date and sc.created_at < (${to}::date + interval '1 day')
            and (${warehouseId}::uuid is null or sc.warehouse_id=${warehouseId}::uuid)
            and (${search}='' or i.name ilike ${`%${search}%`} or w.name ilike ${`%${search}%`})
            and (${status}='' or sc.status::text=${status})
          order by sc.created_at desc, i.name limit ${pageSize} offset ${offset}`);
        break;
      case "inventory":
        rows = await this.executeRows(sql`
          select i.id::text, i.name, coalesce(i.category, 'Grupsuz') as category, i.base_unit as unit,
            i.reorder_level::text as critical_quantity, i.negative_stock_policy as negative_stock_policy,
            i.is_active, coalesce(sum(sm.quantity_delta) filter (where ${warehouseId}::uuid is null or sm.warehouse_id = ${warehouseId}::uuid), 0)::numeric(18,6)::text as available_quantity,
            (coalesce(sum(sm.quantity_delta) filter (where ${warehouseId}::uuid is null or sm.warehouse_id = ${warehouseId}::uuid), 0) <= i.reorder_level) as critical,
            count(*) over()::int as full_count
          from inventory_items i
          left join stock_movements sm on sm.restaurant_id=i.restaurant_id and sm.inventory_item_id=i.id
          where i.restaurant_id=${restaurantId} and (${search}='' or i.name ilike ${`%${search}%`})
            and (${category}='' or i.category=${category}) and (${status}='' or (${status}='ACTIVE' and i.is_active) or (${status}='INACTIVE' and not i.is_active))
          group by i.id order by critical desc, i.name limit ${pageSize} offset ${offset}`);
        break;
      case "warehouses":
        rows = await this.executeRows(sql`
          select w.id::text, w.name, w.code, w.is_active,
            count(distinct sm.inventory_item_id)::int as stocked_items,
            count(sm.id)::int as movement_count, max(sm.occurred_at) as last_movement_at,
            count(*) over()::int as full_count
          from warehouses w left join stock_movements sm on sm.restaurant_id=w.restaurant_id and sm.warehouse_id=w.id
          where w.restaurant_id=${restaurantId} and (${search}='' or w.name ilike ${`%${search}%`} or w.code ilike ${`%${search}%`})
          group by w.id order by w.is_active desc, w.name limit ${pageSize} offset ${offset}`);
        break;
      case "recipes":
      case "costing":
        rows = await this.executeRows(sql`
          with latest_cost as (
            select distinct on (sm.inventory_item_id) sm.inventory_item_id, sm.unit_cost
            from stock_movements sm where sm.restaurant_id=${restaurantId} and sm.unit_cost is not null
            order by sm.inventory_item_id, sm.occurred_at desc
          ), recipe_cost as (
            select rv.id,
              coalesce(sum(ri.quantity * coalesce(lc.unit_cost, 0) * case
                when ri.unit=i.base_unit then 1
                when ri.unit='KG' and i.base_unit='G' then 1000 when ri.unit='G' and i.base_unit='MG' then 1000
                when ri.unit='L' and i.base_unit='ML' then 1000 when ri.unit='G' and i.base_unit='KG' then .001
                when ri.unit='MG' and i.base_unit='G' then .001 when ri.unit='ML' and i.base_unit='L' then .001 else 0 end), 0)::numeric(14,2) as batch_cost,
              count(ri.id)::int as ingredient_count,
              count(ri.id) filter (where lc.unit_cost is null)::int as missing_cost_count
            from recipe_versions rv left join recipe_ingredients ri on ri.restaurant_id=rv.restaurant_id and ri.recipe_version_id=rv.id
            left join inventory_items i on i.restaurant_id=ri.restaurant_id and i.id=ri.inventory_item_id
            left join latest_cost lc on lc.inventory_item_id=ri.inventory_item_id
            where rv.restaurant_id=${restaurantId} group by rv.id
          )
          select rv.id::text, p.id::text as product_id, p.name as product, c.name as category, rv.version,
            rv.status, rv.yield_portions::text as yield_portions, rv.effective_from, rv.effective_to,
            rc.ingredient_count, rc.missing_cost_count, rc.batch_cost::text,
            case when rv.yield_portions > 0 then round(rc.batch_cost / rv.yield_portions, 2)::text else null end as portion_cost,
            p.price::text as selling_price,
            case when rv.yield_portions > 0 then (p.price-round(rc.batch_cost / rv.yield_portions,2))::numeric(14,2)::text else null end as contribution,
            case when p.price > 0 and rv.yield_portions > 0 then round((rc.batch_cost/rv.yield_portions)/p.price*100,2)::text else null end as food_cost_percent,
            count(*) over()::int as full_count
          from recipe_versions rv join products p on p.restaurant_id=rv.restaurant_id and p.id=rv.product_id
          join categories c on c.restaurant_id=p.restaurant_id and c.id=p.category_id join recipe_cost rc on rc.id=rv.id
          where rv.restaurant_id=${restaurantId} and (${search}='' or p.name ilike ${`%${search}%`})
            and (${status}='' or rv.status::text=${status}) and (${category}='' or c.name=${category})
          order by p.name, rv.version desc limit ${pageSize} offset ${offset}`);
        break;
      case "production":
        rows = await this.executeRows(sql`
          select pb.id::text, pb.business_date, p.name as product, rv.version as recipe_version, w.name as warehouse,
            pb.planned_portions::text, pb.actual_portions::text as prepared_portions, pb.sold_portions::text,
            pb.waste_portions::text, greatest(pb.actual_portions-pb.sold_portions-pb.waste_portions,0)::numeric(18,6)::text as remaining_portions,
            case when pb.actual_portions > 0 then round(pb.sold_portions/pb.actual_portions*100,2)::text else null end as sell_through_percent,
            pb.status, count(*) over()::int as full_count
          from production_batches pb join products p on p.restaurant_id=pb.restaurant_id and p.id=pb.product_id
          join recipe_versions rv on rv.restaurant_id=pb.restaurant_id and rv.id=pb.recipe_version_id
          join warehouses w on w.restaurant_id=pb.restaurant_id and w.id=pb.warehouse_id
          where pb.restaurant_id=${restaurantId} and pb.business_date between ${from}::date and ${to}::date
            and (${search}='' or p.name ilike ${`%${search}%`}) and (${status}='' or pb.status::text=${status})
          order by pb.business_date desc, p.name limit ${pageSize} offset ${offset}`);
        break;
      case "waste":
        rows = await this.executeRows(sql`
          select wr.id::text, wr.occurred_at, i.name as inventory_item, w.name as warehouse, wr.quantity::text, wr.unit,
            wr.waste_type, wr.reason, wr.estimated_cost::text, sp.name as recorded_by, count(*) over()::int as full_count
          from waste_records wr left join inventory_items i on i.restaurant_id=wr.restaurant_id and i.id=wr.inventory_item_id
          join warehouses w on w.restaurant_id=wr.restaurant_id and w.id=wr.warehouse_id
          join staff_profiles sp on sp.restaurant_id=wr.restaurant_id and sp.id=wr.recorded_by_staff_id
          where wr.restaurant_id=${restaurantId} and wr.occurred_at >= ${from}::date and wr.occurred_at < (${to}::date + interval '1 day')
            and (${search}='' or i.name ilike ${`%${search}%`} or wr.reason ilike ${`%${search}%`}) and (${status}='' or wr.waste_type::text=${status})
          order by wr.occurred_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "suppliers":
        rows = await this.executeRows(sql`
          select s.id::text, s.name, s.contact_person, s.phone, s.email, s.is_active,
            count(distinct si.id)::int as item_count, count(distinct po.id)::int as purchase_count,
            coalesce(sum(inv.total-inv.paid_total) filter (where inv.status in ('OPEN','PARTIALLY_PAID')),0)::numeric(14,2)::text as outstanding_balance,
            count(*) over()::int as full_count
          from suppliers s left join supplier_items si on si.restaurant_id=s.restaurant_id and si.supplier_id=s.id
          left join purchase_orders po on po.restaurant_id=s.restaurant_id and po.supplier_id=s.id
          left join supplier_invoices inv on inv.restaurant_id=s.restaurant_id and inv.supplier_id=s.id
          where s.restaurant_id=${restaurantId} and (${search}='' or s.name ilike ${`%${search}%`})
            and (${status}='' or (${status}='ACTIVE' and s.is_active) or (${status}='INACTIVE' and not s.is_active))
          group by s.id order by s.is_active desc, s.name limit ${pageSize} offset ${offset}`);
        break;
      case "purchasing":
        rows = await this.executeRows(sql`
          select po.id::text, po.order_number, s.name as supplier, po.created_at as order_date, po.expected_at, po.status,
            coalesce(sum(poi.line_total),0)::numeric(14,2)::text as total,
            coalesce(sum(poi.ordered_quantity),0)::numeric(18,6)::text as ordered_quantity,
            coalesce(sum(poi.received_quantity),0)::numeric(18,6)::text as received_quantity,
            coalesce(sum(poi.ordered_quantity-poi.received_quantity),0)::numeric(18,6)::text as remaining_quantity,
            count(*) over()::int as full_count
          from purchase_orders po join suppliers s on s.restaurant_id=po.restaurant_id and s.id=po.supplier_id
          left join purchase_order_items poi on poi.restaurant_id=po.restaurant_id and poi.purchase_order_id=po.id
          where po.restaurant_id=${restaurantId} and (${search}='' or po.order_number ilike ${`%${search}%`} or s.name ilike ${`%${search}%`})
            and (${status}='' or po.status::text=${status}) and po.created_at >= ${from}::date and po.created_at < (${to}::date+interval '1 day')
          group by po.id,s.name order by po.created_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "payables":
        rows = await this.executeRows(sql`
          select inv.id::text, inv.supplier_id::text, inv.invoice_number, s.name as supplier, inv.created_at as invoice_date, inv.due_date,
            inv.total::text, inv.paid_total::text, (inv.total-inv.paid_total)::numeric(14,2)::text as remaining,
            inv.status, gr.receipt_number, count(*) over()::int as full_count
          from supplier_invoices inv join suppliers s on s.restaurant_id=inv.restaurant_id and s.id=inv.supplier_id
          left join goods_receipts gr on gr.restaurant_id=inv.restaurant_id and gr.id=inv.goods_receipt_id
          where inv.restaurant_id=${restaurantId} and (${search}='' or inv.invoice_number ilike ${`%${search}%`} or s.name ilike ${`%${search}%`})
            and (${status}='' or inv.status::text=${status})
          order by (inv.status in ('OPEN','PARTIALLY_PAID')) desc, inv.due_date nulls last, inv.created_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "price-history":
        // The price a supplier quoted is not the price that was paid; goods
        // receipts carry the real one, so the trend is read from them.
        rows = await this.executeRows(sql`
          with received as (
            select gri.id, gri.created_at, ii.name as item_name, s.name as supplier, gri.received_quantity, gri.unit,
              gri.unit_price, gr.receipt_number,
              lag(gri.unit_price) over (partition by gri.inventory_item_id order by gri.created_at, gri.id) as previous_unit_price
            from goods_receipt_items gri
            join goods_receipts gr on gr.restaurant_id=gri.restaurant_id and gr.id=gri.goods_receipt_id
            join inventory_items ii on ii.restaurant_id=gri.restaurant_id and ii.id=gri.inventory_item_id
            join suppliers s on s.restaurant_id=gr.restaurant_id and s.id=gr.supplier_id
            where gri.restaurant_id=${restaurantId}
          )
          select id::text, created_at, item_name, supplier, receipt_number, unit,
            received_quantity::numeric(18,6)::text as received_quantity,
            unit_price::numeric(14,2)::text as unit_price,
            previous_unit_price::numeric(14,2)::text as previous_unit_price,
            case when previous_unit_price is null or previous_unit_price = 0 then null
                 else round((unit_price - previous_unit_price) * 100 / previous_unit_price, 1)::text end as change_percent,
            count(*) over()::int as full_count
          from received
          where created_at >= ${from}::date and created_at < (${to}::date+interval '1 day')
            and (${search}='' or item_name ilike ${`%${search}%`} or supplier ilike ${`%${search}%`})
          order by created_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "forecast":
        rows = await this.executeRows(sql`
          with daily as (
            select oi.product_id, o.created_at::date as day, sum(oi.quantity)::numeric as sold,
              bool_or(p.is_available=false) as sold_out
            from order_items oi join orders o on o.restaurant_id=oi.restaurant_id and o.id=oi.order_id
            join products p on p.restaurant_id=oi.restaurant_id and p.id=oi.product_id
            where oi.restaurant_id=${restaurantId} and o.created_at >= now()-interval '56 days'
              and o.status in ('SERVED','COMPLETED') and oi.status not in ('CANCELLED','VOIDED')
            group by oi.product_id,o.created_at::date
          )
          select p.id::text, p.name as product, c.name as category, count(d.day)::int as observations,
            round(avg(d.sold) filter (where d.day >= current_date-14),2)::text as recent_average,
            round(avg(d.sold) filter (where extract(isodow from d.day)=extract(isodow from current_date+1)),2)::text as same_weekday_average,
            case when count(d.day) >= 4 then round((coalesce(avg(d.sold) filter (where d.day >= current_date-14),0)*0.6 + coalesce(avg(d.sold) filter (where extract(isodow from d.day)=extract(isodow from current_date+1)),0)*0.4),0)::text else null end as suggested_portions,
            count(*) over()::int as full_count
          from products p join categories c on c.restaurant_id=p.restaurant_id and c.id=p.category_id
          left join daily d on d.product_id=p.id and not d.sold_out
          where p.restaurant_id=${restaurantId} and p.deleted_at is null and p.is_active and (${search}='' or p.name ilike ${`%${search}%`})
          group by p.id,c.name order by p.name limit ${pageSize} offset ${offset}`);
        notice = "Öneri, son 56 gün içindeki sınırlı veriyi kullanır; satışı kapalı günler sansürlenir. Dört gözlemden azsa öneri üretilmez.";
        break;
      case "menu-engineering":
        rows = await this.executeRows(sql`
          with sales as (
            select oi.product_id, sum(oi.quantity)::int as sales
            from order_items oi join orders o on o.restaurant_id=oi.restaurant_id and o.id=oi.order_id
            where oi.restaurant_id=${restaurantId} and o.created_at >= now()-interval '30 days' and o.status in ('SERVED','COMPLETED') and oi.status not in ('CANCELLED','VOIDED')
            group by oi.product_id
          ), cost as (
            select rv.product_id, rv.id as recipe_id, coalesce(sum(ri.quantity*coalesce(lc.unit_price,0))/nullif(rv.yield_portions,0),0)::numeric(14,2) as portion_cost
            from recipe_versions rv left join recipe_ingredients ri on ri.restaurant_id=rv.restaurant_id and ri.recipe_version_id=rv.id
            left join lateral (select gri.unit_price from goods_receipt_items gri where gri.restaurant_id=ri.restaurant_id and gri.inventory_item_id=ri.inventory_item_id order by gri.created_at desc limit 1) lc on true
            where rv.restaurant_id=${restaurantId} and rv.status='ACTIVE' group by rv.product_id,rv.id,rv.yield_portions
          ), baselines as (select avg(coalesce(sales,0)) as avg_sales, avg(p.price-coalesce(cost.portion_cost,0)) as avg_contribution from products p left join sales on sales.product_id=p.id left join cost on cost.product_id=p.id where p.restaurant_id=${restaurantId} and p.is_active)
          select p.id::text, p.name as product, c.name as category, coalesce(s.sales,0) as sales,
            p.price::text as selling_price, coalesce(cost.portion_cost,0)::text as portion_cost,
            (p.price-coalesce(cost.portion_cost,0))::numeric(14,2)::text as contribution,
            case when p.price>0 then round(coalesce(cost.portion_cost,0)/p.price*100,2)::text else null end as food_cost_percent,
            case when coalesce(s.sales,0)>=b.avg_sales and p.price-coalesce(cost.portion_cost,0)>=b.avg_contribution then 'Yüksek Performans'
                 when coalesce(s.sales,0)>=b.avg_sales then 'Popüler / Düşük Marj'
                 when p.price-coalesce(cost.portion_cost,0)>=b.avg_contribution then 'Yüksek Marj / Düşük Talep'
                 else 'Düşük Performans' end as classification,
            count(*) over()::int as full_count
          from products p join categories c on c.restaurant_id=p.restaurant_id and c.id=p.category_id
          left join sales s on s.product_id=p.id left join cost on cost.product_id=p.id cross join baselines b
          where p.restaurant_id=${restaurantId} and p.deleted_at is null and (${search}='' or p.name ilike ${`%${search}%`}) and (${category}='' or c.name=${category})
          order by coalesce(s.sales,0) desc,p.name limit ${pageSize} offset ${offset}`);
        break;
      case "popular":
        rows = await this.executeRows(sql`
          select pps.product_id::text as id, p.name as product, pps.quantity_sold, pps.rank, pps.window_days, pps.calculated_at,
            count(*) over()::int as full_count
          from popular_product_snapshots pps join products p on p.restaurant_id=pps.restaurant_id and p.id=pps.product_id
          where pps.restaurant_id=${restaurantId} and pps.window_days=30 and (${search}='' or p.name ilike ${`%${search}%`})
          order by pps.rank limit ${pageSize} offset ${offset}`);
        break;
      case "attendance":
        rows = await this.executeRows(sql`
          select ar.id::text, sp.name as staff, ar.business_date, ar.clock_in_at, ar.clock_out_at, ar.break_minutes, ar.status,
            case when ar.clock_out_at is null then null else greatest(floor(extract(epoch from (ar.clock_out_at-ar.clock_in_at))/60)::int-ar.break_minutes,0) end as duration_minutes,
            ar.correction_reason, count(*) over()::int as full_count
          from attendance_records ar join staff_profiles sp on sp.restaurant_id=ar.restaurant_id and sp.id=ar.staff_id
          where ar.restaurant_id=${restaurantId} and ar.business_date between ${from}::date and ${to}::date
            and (${search}='' or sp.name ilike ${`%${search}%`}) and (${status}='' or ar.status::text=${status})
          order by ar.business_date desc,ar.clock_in_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "schedules":
        rows = await this.executeRows(sql`
          select ss.id::text, sp.name as staff, ss.starts_at, ss.ends_at, ss.role_label, ss.location_label, ss.notes, ss.status,
            count(*) over()::int as full_count
          from staff_schedules ss join staff_profiles sp on sp.restaurant_id=ss.restaurant_id and sp.id=ss.staff_id
          where ss.restaurant_id=${restaurantId} and ss.starts_at >= ${from}::date and ss.starts_at < (${to}::date+interval '1 day')
            and (${search}='' or sp.name ilike ${`%${search}%`}) and (${status}='' or ss.status::text=${status})
          order by ss.starts_at,sp.name limit ${pageSize} offset ${offset}`);
        break;
      case "payroll":
        rows = await this.executeRows(sql`
          select pe.id::text, sp.name as staff, pe.period_start, pe.period_end, pe.worked_minutes, pe.overtime_minutes,
            pe.gross_salary::text, pe.allowances::text, pe.deductions::text, pe.net_payable::text, pe.status, pe.correction_reason,
            count(*) over()::int as full_count
          from payroll_entries pe join staff_profiles sp on sp.restaurant_id=pe.restaurant_id and sp.id=pe.staff_id
          where pe.restaurant_id=${restaurantId} and (${search}='' or sp.name ilike ${`%${search}%`}) and (${status}='' or pe.status::text=${status})
          order by pe.period_start desc,sp.name limit ${pageSize} offset ${offset}`);
        notice = "Operasyonel Bordro Kaydı — SGK, vergi veya yasal bordro hesabı içermez.";
        break;
      case "feedback":
        rows = await this.executeRows(sql`
          select cf.id::text, cf.created_at, cf.rating, cf.food_rating, cf.service_rating, cf.cleanliness_rating,
            cf.comment, cf.status, case when cf.rating<=2 then true else false end as low_rating,
            count(*) over()::int as full_count
          from customer_feedback cf where cf.restaurant_id=${restaurantId} and cf.created_at >= ${from}::date and cf.created_at < (${to}::date+interval '1 day')
            and (${search}='' or cf.comment ilike ${`%${search}%`}) and (${status}='' or cf.status::text=${status})
          order by low_rating desc,cf.created_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "reservations":
        rows = await this.executeRows(sql`
          select r.id::text, r.starts_at, r.ends_at, r.customer_name, r.phone, r.party_size, rt.name as table_name,
            r.status, r.notes, count(*) over()::int as full_count
          from reservations r left join restaurant_tables rt on rt.restaurant_id=r.restaurant_id and rt.id=r.table_id
          where r.restaurant_id=${restaurantId} and r.starts_at >= ${from}::date and r.starts_at < (${to}::date+interval '1 day')
            and (${search}='' or r.customer_name ilike ${`%${search}%`} or r.phone ilike ${`%${search}%`}) and (${status}='' or r.status::text=${status})
          order by r.starts_at limit ${pageSize} offset ${offset}`);
        break;
      case "fulfillment":
        // The money is summed from the lines rather than stored twice: the
        // request has no total column, so there is nothing that can drift.
        rows = await this.executeRows(sql`
          select fr.id::text, fr.created_at, fr.requested_at, fr.channel, fr.status, fr.customer_name, fr.contact,
            fr.address, fr.delivery_notes, count(fi.id)::int as item_count,
            coalesce(sum(fi.line_total),0)::text as lines_total, fr.delivery_fee::text as delivery_fee,
            -- Once an order carries the request, the order is the money; the
            -- request stops being a second opinion on what is owed.
            (coalesce(o.total, coalesce(sum(fi.line_total),0)) + fr.delivery_fee)::text as total,
            o.order_number, o.status as order_status,
            case when fr.order_id is null then 'NOT_LINKED' else 'LINKED' end as kitchen_link,
            count(*) over()::int as full_count
          from fulfillment_requests fr
          left join fulfillment_request_items fi on fi.restaurant_id=fr.restaurant_id and fi.fulfillment_request_id=fr.id
          left join orders o on o.restaurant_id=fr.restaurant_id and o.id=fr.order_id
          where fr.restaurant_id=${restaurantId} and fr.created_at >= ${from}::date and fr.created_at < (${to}::date+interval '1 day')
            and (${search}='' or fr.customer_name ilike ${`%${search}%`} or fr.contact ilike ${`%${search}%`})
            and (${status}='' or fr.status::text=${status}) and (${category}='' or fr.channel::text=${category})
          group by fr.id, o.id order by fr.created_at desc limit ${pageSize} offset ${offset}`);
        break;
      case "customers":
        rows = await this.executeRows(sql`
          select ca.id::text, ca.name, ca.email, ca.phone, ca.marketing_consent, ca.is_active, ca.created_at,
            count(distinct col.order_id)::int as linked_orders,
            coalesce(sum(case when ll.entry_type in ('EARN','ADJUST') then ll.points when ll.entry_type in ('REDEEM','EXPIRE') then -ll.points else 0 end),0)::int as loyalty_balance,
            count(*) over()::int as full_count
          from customer_accounts ca left join customer_order_links col on col.restaurant_id=ca.restaurant_id and col.customer_account_id=ca.id
          left join loyalty_ledger ll on ll.restaurant_id=ca.restaurant_id and ll.customer_account_id=ca.id
          where ca.restaurant_id=${restaurantId} and (${search}='' or ca.name ilike ${`%${search}%`} or ca.email ilike ${`%${search}%`})
          group by ca.id order by ca.created_at desc limit ${pageSize} offset ${offset}`);
        notice = "Müşteri hesabı isteğe bağlıdır; misafir QR menü kullanımı değişmeden devam eder.";
        break;
      case "loyalty":
        rows = [];
        notice = "Sadakat Programı henüz etkin değil. Kazanım ve kullanım kuralları yapılandırılmadan puan hareketi oluşturulmaz.";
        break;
      case "integrations":
        rows = await this.executeRows(sql`
          select ic.id::text, ic.kind, ic.provider, ic.display_name, ic.is_enabled,
            case when ic.secret_reference is null then 'NOT_CONFIGURED' when ic.is_enabled then 'CONFIGURED' else 'NOT_CONFIGURED' end as status,
            ic.updated_at, count(*) over()::int as full_count
          from integration_connections ic where ic.restaurant_id=${restaurantId} and (${search}='' or ic.display_name ilike ${`%${search}%`} or ic.provider ilike ${`%${search}%`})
          order by ic.kind,ic.display_name limit ${pageSize} offset ${offset}`);
        notice = "Canlı POS, e-Fatura/e-Arşiv, ÖKC, muhasebe ve teslimat sağlayıcısı dış sağlayıcı yapılandırması gerektirir. Gizli değerler bu ekranda gösterilmez.";
        break;
      case "reports":
        // One pass over each source table, then the numbers are pivoted into
        // named rows. The sales block is deliberately the same basis the
        // finance summary uses, so Masada + Paket + Kurye reconciles with the
        // gross-sales row rather than being a second opinion on it.
        rows = await this.executeRows(sql`
          with sales as (
            select coalesce(sum(total) filter (where channel='DINE_IN'),0)::numeric(14,2) as dine_in,
              coalesce(sum(total) filter (where channel='TAKEAWAY'),0)::numeric(14,2) as takeaway,
              coalesce(sum(total) filter (where channel='DELIVERY'),0)::numeric(14,2) as delivery,
              coalesce(sum(total),0)::numeric(14,2) as gross
            from orders where restaurant_id=${restaurantId} and status in ('SERVED','COMPLETED')
              and created_at >= ${from}::date and created_at < (${to}::date+interval '1 day')
          )
          select report_name, metric, value, unit, count(*) over()::int as full_count from (
            select 'Satış'::text as report_name, 'Masada'::text as metric, dine_in::text as value, 'TRY'::text as unit, 1 as sort_order from sales
            union all select 'Satış','Paket',takeaway::text,'TRY',2 from sales
            union all select 'Satış','Kurye',delivery::text,'TRY',3 from sales
            union all select 'Satış','Toplam brüt satış',gross::text,'TRY',4 from sales
            union all select 'Stok','Kritik stok kalemi',count(*)::text,'adet',5 from inventory_items i where i.restaurant_id=${restaurantId} and i.is_active and (select coalesce(sum(sm.quantity_delta),0) from stock_movements sm where sm.restaurant_id=i.restaurant_id and sm.inventory_item_id=i.id)<=i.reorder_level
            union all select 'Üretim','Hazırlanan porsiyon',coalesce(sum(actual_portions),0)::numeric(18,2)::text,'porsiyon',6 from production_batches where restaurant_id=${restaurantId} and business_date between ${from}::date and ${to}::date
            union all select 'Fire','Tahmini fire maliyeti',coalesce(sum(estimated_cost),0)::numeric(14,2)::text,'TRY',7 from waste_records where restaurant_id=${restaurantId} and occurred_at>=${from}::date and occurred_at<(${to}::date+interval '1 day')
            union all select 'Satın Alma','Açık sipariş',count(*)::text,'adet',8 from purchase_orders where restaurant_id=${restaurantId} and status in ('DRAFT','SENT','PARTIALLY_RECEIVED')
            union all select 'Borçlar','Açık tedarikçi borcu',coalesce(sum(total-paid_total),0)::numeric(14,2)::text,'TRY',9 from supplier_invoices where restaurant_id=${restaurantId} and status in ('OPEN','PARTIALLY_PAID')
            union all select 'Puantaj','Tamamlanan mesai',count(*)::text,'kayıt',10 from attendance_records where restaurant_id=${restaurantId} and business_date between ${from}::date and ${to}::date and status in ('COMPLETED','CORRECTED')
          ) report order by sort_order limit ${pageSize} offset ${offset}`);
        break;
    }

    const total = totalFrom(rows);
    const options = await optionsPromise;
    return {
      module: query.module,
      generatedAt: new Date().toISOString(),
      rows: withoutCount(rows),
      summary: { totalRecords: total, dateFrom: from, dateTo: to },
      options,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      ...(notice ? { notice } : {}),
    };
  }

  execute(input: Parameters<ErpWorkspaceRepository["execute"]>[0]): Promise<Record<string, unknown>> {
    const { command } = input;
    switch (command.command) {
      case "TRANSFER_STOCK": return this.transferStock(input);
      case "CONFIRM_STOCK_COUNT": return this.confirmStockCount(input);
      case "UPDATE_INVENTORY_ITEM": return this.updateInventoryItem(input);
      case "UPDATE_DRAFT_RECIPE": return this.updateDraftRecipe(input);
      case "SET_RECIPE_STATUS": return this.setRecipeStatus(input);
      case "UPDATE_SUPPLIER": return this.updateSupplier(input);
      case "UPSERT_SUPPLIER_ITEM": return this.upsertSupplierItem(input);
      case "SET_PURCHASE_ORDER_STATUS": return this.setPurchaseOrderStatus(input);
      case "CORRECT_ATTENDANCE": return this.correctAttendance(input);
      case "SET_SCHEDULE_STATUS": return this.setScheduleStatus(input);
      case "UPSERT_PAYROLL": return this.upsertPayroll(input);
      case "SET_FEEDBACK_STATUS": return this.setFeedbackStatus(input);
      case "UPDATE_RESERVATION": return this.updateReservation(input);
      case "SET_RESERVATION_STATUS": return this.setReservationStatus(input);
      case "LINK_FULFILLMENT_ORDER": return this.linkFulfillmentOrder(input);
      case "SET_FULFILLMENT_STATUS": return this.setFulfillmentStatus(input);
    }
  }

  private transferStock(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const command = input.command;
    if (command.command !== "TRANSFER_STOCK") throw new Error("Unexpected command");
    if (command.sourceWarehouseId === command.destinationWarehouseId) throw validationError("Kaynak ve hedef depo farklı olmalıdır.");
    const keys = stockTransferKeys(command.idempotencyKey);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${keys.transferId}`},0))`);
      const [existing] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(eq(stockMovements.restaurantId,input.restaurantId),eq(stockMovements.idempotencyKey,keys.out))).limit(1);
      if (existing) return { id: existing.id, replayed: true };
      for (const warehouse of [command.sourceWarehouseId,command.destinationWarehouseId].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${command.inventoryItemId}:${warehouse}`},0))`);
      }
      const [item] = await tx.select({ policy: inventoryItems.negativeStockPolicy, baseUnit: inventoryItems.baseUnit }).from(inventoryItems).where(and(eq(inventoryItems.restaurantId,input.restaurantId),eq(inventoryItems.id,command.inventoryItemId),eq(inventoryItems.isActive,true))).limit(1);
      if (!item) throw new DomainError("NOT_FOUND","Aktif stok kalemi bulunamadı.",{httpStatus:404});
      const [balance] = await tx.select({ value: sql<string>`coalesce(sum(${stockMovements.quantityDelta}),0)::numeric(18,6)` }).from(stockMovements).where(and(eq(stockMovements.restaurantId,input.restaurantId),eq(stockMovements.inventoryItemId,command.inventoryItemId),eq(stockMovements.warehouseId,command.sourceWarehouseId)));
      evaluateStockBalance(parseFixedDecimal(balance?.value ?? "0",6),-parseFixedDecimal(command.quantity.replace(",","."),6),item.policy,{ unit: ERP_UNIT_LABELS[item.baseUnit] });
      const [out] = await tx.insert(stockMovements).values({ restaurantId:input.restaurantId,inventoryItemId:command.inventoryItemId,warehouseId:command.sourceWarehouseId,movementType:"TRANSFER_OUT",quantityDelta:`-${command.quantity.replace(",",".")}`,sourceType:"WAREHOUSE_TRANSFER",idempotencyKey:keys.out,reason:command.note,actorStaffId:input.audit.actorStaffId }).returning({id:stockMovements.id});
      await tx.insert(stockMovements).values({ restaurantId:input.restaurantId,inventoryItemId:command.inventoryItemId,warehouseId:command.destinationWarehouseId,movementType:"TRANSFER_IN",quantityDelta:command.quantity.replace(",","."),sourceType:"WAREHOUSE_TRANSFER",sourceId:out.id,idempotencyKey:keys.in,reason:command.note,actorStaffId:input.audit.actorStaffId });
      await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.stock_transfer.completed",entityType:"stock_transfer",entityId:out.id,newValue:{inventoryItemId:command.inventoryItemId,sourceWarehouseId:command.sourceWarehouseId,destinationWarehouseId:command.destinationWarehouseId,quantity:command.quantity,note:command.note},requestId:input.audit.requestId});
      return { id:out.id,replayed:false };
    });
  }

  private confirmStockCount(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const command=input.command; if(command.command!=="CONFIRM_STOCK_COUNT") throw new Error("Unexpected command");
    return this.db.transaction(async(tx)=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:count:${command.idempotencyKey}`},0))`);
      const [existing]=await tx.select({id:stockMovements.id,sourceId:stockMovements.sourceId}).from(stockMovements).where(and(eq(stockMovements.restaurantId,input.restaurantId),eq(stockMovements.idempotencyKey,`count:${command.idempotencyKey}:${command.lines[0]!.inventoryItemId}`))).limit(1);
      if(existing) return {id:existing.sourceId??existing.id,replayed:true};
      const [created]=await tx.insert(stockCounts).values({restaurantId:input.restaurantId,warehouseId:command.warehouseId,status:"DRAFT",countedByStaffId:input.audit.actorStaffId}).returning({id:stockCounts.id});
      for(const line of [...command.lines].sort((a,b)=>a.inventoryItemId.localeCompare(b.inventoryItemId))){
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${line.inventoryItemId}:${command.warehouseId}`},0))`);
        const [balance]=await tx.select({value:sql<string>`coalesce(sum(${stockMovements.quantityDelta}),0)::numeric(18,6)`}).from(stockMovements).where(and(eq(stockMovements.restaurantId,input.restaurantId),eq(stockMovements.inventoryItemId,line.inventoryItemId),eq(stockMovements.warehouseId,command.warehouseId)));
        const expected=parseFixedDecimal(balance?.value??"0",6); const counted=parseFixedDecimal(line.countedQuantity.replace(",","."),6); const variance=counted-expected;
        await tx.insert(stockCountLines).values({restaurantId:input.restaurantId,stockCountId:created.id,inventoryItemId:line.inventoryItemId,expectedQuantity:formatFixedDecimal(expected,6),countedQuantity:formatFixedDecimal(counted,6),varianceQuantity:formatFixedDecimal(variance,6)});
        if(variance!==0n) await tx.insert(stockMovements).values({restaurantId:input.restaurantId,inventoryItemId:line.inventoryItemId,warehouseId:command.warehouseId,movementType:"COUNT_CORRECTION",quantityDelta:formatFixedDecimal(variance,6),sourceType:"STOCK_COUNT",sourceId:created.id,idempotencyKey:`count:${command.idempotencyKey}:${line.inventoryItemId}`,reason:"Fiziksel sayım farkı",actorStaffId:input.audit.actorStaffId});
      }
      await tx.update(stockCounts).set({status:"COMPLETED",completedAt:new Date(),updatedAt:new Date()}).where(and(eq(stockCounts.restaurantId,input.restaurantId),eq(stockCounts.id,created.id)));
      await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.stock_count.completed",entityType:"stock_count",entityId:created.id,newValue:{warehouseId:command.warehouseId,lineCount:command.lines.length},requestId:input.audit.requestId});
      return {id:created.id,replayed:false};
    });
  }

  private updateInventoryItem(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const c=input.command;if(c.command!=="UPDATE_INVENTORY_ITEM") throw new Error("Unexpected command");
    return this.db.transaction(async tx=>{const [before]=await tx.select().from(inventoryItems).where(and(eq(inventoryItems.restaurantId,input.restaurantId),eq(inventoryItems.id,c.inventoryItemId))).for("update").limit(1);if(!before)throw new DomainError("NOT_FOUND","Stok kalemi bulunamadı.",{httpStatus:404});await tx.update(inventoryItems).set({category:c.category,reorderLevel:c.reorderLevel.replace(",","."),negativeStockPolicy:c.negativeStockPolicy,isActive:c.isActive,updatedAt:new Date()}).where(and(eq(inventoryItems.restaurantId,input.restaurantId),eq(inventoryItems.id,c.inventoryItemId)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.inventory_item.updated",entityType:"inventory_item",entityId:c.inventoryItemId,oldValue:{category:before.category,reorderLevel:before.reorderLevel,negativeStockPolicy:before.negativeStockPolicy,isActive:before.isActive},newValue:{category:c.category,reorderLevel:c.reorderLevel,negativeStockPolicy:c.negativeStockPolicy,isActive:c.isActive},requestId:input.audit.requestId});return{id:c.inventoryItemId};});
  }

  private updateDraftRecipe(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const c=input.command;if(c.command!=="UPDATE_DRAFT_RECIPE")throw new Error("Unexpected command");
    return this.db.transaction(async tx=>{const [recipe]=await tx.select({id:recipeVersions.id,status:recipeVersions.status}).from(recipeVersions).where(and(eq(recipeVersions.restaurantId,input.restaurantId),eq(recipeVersions.id,c.recipeVersionId))).for("update").limit(1);if(!recipe)throw new DomainError("NOT_FOUND","Reçete bulunamadı.",{httpStatus:404});if(recipe.status!=="DRAFT")throw new DomainError("CONFLICT","Yalnızca taslak reçete düzenlenebilir.",{httpStatus:409});if(new Set(c.ingredients.map(x=>x.inventoryItemId)).size!==c.ingredients.length)throw new DomainError("CONFLICT","Aynı stok kalemi reçetede bir kez yer alabilir.",{httpStatus:409});for(const line of c.ingredients){const [item]=await tx.select({baseUnit:inventoryItems.baseUnit}).from(inventoryItems).where(and(eq(inventoryItems.restaurantId,input.restaurantId),eq(inventoryItems.id,line.inventoryItemId))).limit(1);if(!item)throw new DomainError("NOT_FOUND","Reçete stok kalemi bulunamadı.",{httpStatus:404});try{convertQuantity(line.quantity.replace(",","."),line.unit,item.baseUnit);}catch{throw validationError(`${line.unit} birimi ${item.baseUnit} temel birimine dönüştürülemiyor.`);}}await tx.delete(recipeIngredients).where(and(eq(recipeIngredients.restaurantId,input.restaurantId),eq(recipeIngredients.recipeVersionId,c.recipeVersionId)));await tx.insert(recipeIngredients).values(c.ingredients.map(line=>({restaurantId:input.restaurantId,recipeVersionId:c.recipeVersionId,inventoryItemId:line.inventoryItemId,quantity:line.quantity.replace(",","."),unit:line.unit})));await tx.update(recipeVersions).set({yieldPortions:c.yieldPortions.replace(",","."),updatedAt:new Date()}).where(and(eq(recipeVersions.restaurantId,input.restaurantId),eq(recipeVersions.id,c.recipeVersionId)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.recipe.updated",entityType:"recipe_version",entityId:c.recipeVersionId,newValue:{yieldPortions:c.yieldPortions,ingredientCount:c.ingredients.length},requestId:input.audit.requestId});return{id:c.recipeVersionId};});
  }

  private setRecipeStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const c=input.command;if(c.command!=="SET_RECIPE_STATUS")throw new Error("Unexpected command");
    return this.db.transaction(async tx=>{const [recipe]=await tx.select({id:recipeVersions.id,productId:recipeVersions.productId,status:recipeVersions.status}).from(recipeVersions).where(and(eq(recipeVersions.restaurantId,input.restaurantId),eq(recipeVersions.id,c.recipeVersionId))).for("update").limit(1);if(!recipe)throw new DomainError("NOT_FOUND","Reçete bulunamadı.",{httpStatus:404});assertRecipeLifecycleTransition(recipe.status as RecipeLifecycleStatus,c.status);await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.restaurantId}:${recipe.productId}:recipe`},0))`);const at=new Date();if(c.status==="ACTIVE")await tx.update(recipeVersions).set({status:"RETIRED",effectiveTo:at,updatedAt:at}).where(and(eq(recipeVersions.restaurantId,input.restaurantId),eq(recipeVersions.productId,recipe.productId),eq(recipeVersions.status,"ACTIVE"),ne(recipeVersions.id,recipe.id)));await tx.update(recipeVersions).set({status:c.status,effectiveFrom:c.status==="ACTIVE"?at:undefined,effectiveTo:c.status==="RETIRED"?at:null,updatedAt:at}).where(and(eq(recipeVersions.restaurantId,input.restaurantId),eq(recipeVersions.id,recipe.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:c.status==="ACTIVE"?"erp.recipe.activated":"erp.recipe.retired",entityType:"recipe_version",entityId:recipe.id,oldValue:{status:recipe.status},newValue:{status:c.status},requestId:input.audit.requestId});return{id:recipe.id,status:c.status};});
  }

  private updateSupplier(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="UPDATE_SUPPLIER")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [before]=await tx.select().from(suppliers).where(and(eq(suppliers.restaurantId,input.restaurantId),eq(suppliers.id,c.supplierId))).for("update").limit(1);if(!before)throw new DomainError("NOT_FOUND","Tedarikçi bulunamadı.",{httpStatus:404});await tx.update(suppliers).set({name:c.name,contactPerson:c.contactPerson,phone:c.phone,email:c.email,notes:c.notes,isActive:c.isActive,updatedAt:new Date()}).where(and(eq(suppliers.restaurantId,input.restaurantId),eq(suppliers.id,c.supplierId)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.supplier.updated",entityType:"supplier",entityId:c.supplierId,oldValue:{name:before.name,isActive:before.isActive},newValue:{name:c.name,isActive:c.isActive},requestId:input.audit.requestId});return{id:c.supplierId};});}

  private upsertSupplierItem(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="UPSERT_SUPPLIER_ITEM")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.insert(supplierItems).values({restaurantId:input.restaurantId,supplierId:c.supplierId,inventoryItemId:c.inventoryItemId,supplierItemCode:c.supplierItemCode,packQuantity:c.packQuantity.replace(",","."),packUnit:c.packUnit,lastUnitPrice:c.lastUnitPrice.replace(",","."),leadTimeDays:c.leadTimeDays,isActive:c.isActive}).onConflictDoUpdate({target:[supplierItems.supplierId,supplierItems.inventoryItemId],set:{supplierItemCode:c.supplierItemCode,packQuantity:c.packQuantity.replace(",","."),packUnit:c.packUnit,lastUnitPrice:c.lastUnitPrice.replace(",","."),leadTimeDays:c.leadTimeDays,isActive:c.isActive,updatedAt:new Date()}}).returning({id:supplierItems.id});await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.supplier_item.upserted",entityType:"supplier_item",entityId:row.id,newValue:{supplierId:c.supplierId,inventoryItemId:c.inventoryItemId,packQuantity:c.packQuantity,packUnit:c.packUnit,lastUnitPrice:c.lastUnitPrice},requestId:input.audit.requestId});return{id:row.id};});}

  private setPurchaseOrderStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="SET_PURCHASE_ORDER_STATUS")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.select({id:purchaseOrders.id,status:purchaseOrders.status}).from(purchaseOrders).where(and(eq(purchaseOrders.restaurantId,input.restaurantId),eq(purchaseOrders.id,c.purchaseOrderId))).for("update").limit(1);if(!row)throw new DomainError("NOT_FOUND","Satın alma siparişi bulunamadı.",{httpStatus:404});assertPurchaseTransition(row.status as PurchaseWorkflowStatus,c.status);const at=new Date();await tx.update(purchaseOrders).set({status:c.status,sentAt:c.status==="SENT"?at:undefined,cancelledAt:c.status==="CANCELLED"?at:undefined,updatedAt:at}).where(and(eq(purchaseOrders.restaurantId,input.restaurantId),eq(purchaseOrders.id,row.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.purchase_order.status_changed",entityType:"purchase_order",entityId:row.id,oldValue:{status:row.status},newValue:{status:c.status},requestId:input.audit.requestId});return{id:row.id,status:c.status};});}

  private correctAttendance(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="CORRECT_ATTENDANCE")throw new Error("Unexpected command");if(c.clockOutAt&&c.clockOutAt<=c.clockInAt)throw validationError("Mesai bitişi başlangıçtan sonra olmalıdır.");return this.db.transaction(async tx=>{const [row]=await tx.select().from(attendanceRecords).where(and(eq(attendanceRecords.restaurantId,input.restaurantId),eq(attendanceRecords.id,c.attendanceRecordId))).for("update").limit(1);if(!row)throw new DomainError("NOT_FOUND","Puantaj kaydı bulunamadı.",{httpStatus:404});await tx.update(attendanceRecords).set({clockInAt:c.clockInAt,clockOutAt:c.clockOutAt,breakMinutes:c.breakMinutes,status:"CORRECTED",correctionReason:c.reason,correctedByStaffId:input.audit.actorStaffId,updatedAt:new Date()}).where(and(eq(attendanceRecords.restaurantId,input.restaurantId),eq(attendanceRecords.id,row.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.attendance.corrected",entityType:"attendance_record",entityId:row.id,oldValue:{clockInAt:row.clockInAt.toISOString(),clockOutAt:row.clockOutAt?.toISOString()??null,breakMinutes:row.breakMinutes,status:row.status},newValue:{clockInAt:c.clockInAt.toISOString(),clockOutAt:c.clockOutAt?.toISOString()??null,breakMinutes:c.breakMinutes,status:"CORRECTED"},metadata:{reason:c.reason},requestId:input.audit.requestId});return{id:row.id,status:"CORRECTED"};});}

  private setScheduleStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="SET_SCHEDULE_STATUS")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.select({id:staffSchedules.id,status:staffSchedules.status}).from(staffSchedules).where(and(eq(staffSchedules.restaurantId,input.restaurantId),eq(staffSchedules.id,c.scheduleId))).for("update").limit(1);if(!row)throw new DomainError("NOT_FOUND","Vardiya planı bulunamadı.",{httpStatus:404});if(row.status==="CANCELLED"||row.status==="COMPLETED")throw new DomainError("CONFLICT","Tamamlanmış vardiya değiştirilemez.",{httpStatus:409});await tx.update(staffSchedules).set({status:c.status,updatedAt:new Date()}).where(and(eq(staffSchedules.restaurantId,input.restaurantId),eq(staffSchedules.id,row.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.schedule.status_changed",entityType:"staff_schedule",entityId:row.id,oldValue:{status:row.status},newValue:{status:c.status},requestId:input.audit.requestId});return{id:row.id,status:c.status};});}

  private upsertPayroll(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="UPSERT_PAYROLL")throw new Error("Unexpected command");if(c.periodEnd<c.periodStart)throw validationError("Bordro dönem sonu başlangıçtan önce olamaz.");const net=payrollNetPayable(parseFixedDecimal(c.grossSalary.replace(",","."),2),parseFixedDecimal(c.allowances.replace(",","."),2),parseFixedDecimal(c.deductions.replace(",","."),2));if(net<0n)throw validationError("Net ödenecek tutar negatif olamaz.");return this.db.transaction(async tx=>{const [row]=await tx.insert(payrollEntries).values({restaurantId:input.restaurantId,staffId:c.staffId,periodStart:c.periodStart,periodEnd:c.periodEnd,workedMinutes:c.workedMinutes,overtimeMinutes:c.overtimeMinutes,grossSalary:c.grossSalary.replace(",","."),allowances:c.allowances.replace(",","."),deductions:c.deductions.replace(",","."),netPayable:formatFixedDecimal(net,2),status:c.status,correctionReason:c.correctionReason,approvedByStaffId:c.status==="APPROVED"||c.status==="PAID"?input.audit.actorStaffId:null}).onConflictDoUpdate({target:[payrollEntries.restaurantId,payrollEntries.staffId,payrollEntries.periodStart,payrollEntries.periodEnd],set:{workedMinutes:c.workedMinutes,overtimeMinutes:c.overtimeMinutes,grossSalary:c.grossSalary.replace(",","."),allowances:c.allowances.replace(",","."),deductions:c.deductions.replace(",","."),netPayable:formatFixedDecimal(net,2),status:c.status,correctionReason:c.correctionReason,approvedByStaffId:c.status==="APPROVED"||c.status==="PAID"?input.audit.actorStaffId:null,updatedAt:new Date()}}).returning({id:payrollEntries.id});await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.payroll.upserted",entityType:"payroll_entry",entityId:row.id,newValue:{periodStart:c.periodStart,periodEnd:c.periodEnd,netPayable:formatFixedDecimal(net,2),status:c.status,operationalOnly:true},requestId:input.audit.requestId});return{id:row.id,netPayable:formatFixedDecimal(net,2)};});}

  private setFeedbackStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="SET_FEEDBACK_STATUS")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.update(customerFeedback).set({status:c.status,reviewedByStaffId:input.audit.actorStaffId,updatedAt:new Date()}).where(and(eq(customerFeedback.restaurantId,input.restaurantId),eq(customerFeedback.id,c.feedbackId))).returning({id:customerFeedback.id});if(!row)throw new DomainError("NOT_FOUND","Geri bildirim bulunamadı.",{httpStatus:404});await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.feedback.moderated",entityType:"customer_feedback",entityId:row.id,newValue:{status:c.status},requestId:input.audit.requestId});return{id:row.id,status:c.status};});}

  private updateReservation(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="UPDATE_RESERVATION")throw new Error("Unexpected command");if(c.endsAt<=c.startsAt)throw validationError("Rezervasyon bitişi başlangıçtan sonra olmalıdır.");return this.db.transaction(async tx=>{const [before]=await tx.select().from(reservations).where(and(eq(reservations.restaurantId,input.restaurantId),eq(reservations.id,c.reservationId))).for("update").limit(1);if(!before)throw new DomainError("NOT_FOUND","Rezervasyon bulunamadı.",{httpStatus:404});if(c.tableId){const overlap=await tx.select({id:reservations.id}).from(reservations).where(and(eq(reservations.restaurantId,input.restaurantId),eq(reservations.tableId,c.tableId),ne(reservations.id,c.reservationId),inArray(reservations.status,["CONFIRMED","SEATED"]),lt(reservations.startsAt,c.endsAt),gt(reservations.endsAt,c.startsAt))).limit(1);if(overlap.length)throw new DomainError("CONFLICT","Masa bu zaman aralığında başka rezervasyona ayrılmış.",{httpStatus:409});}await tx.update(reservations).set({tableId:c.tableId,customerName:c.customerName,phone:c.phone,partySize:c.partySize,startsAt:c.startsAt,endsAt:c.endsAt,notes:c.notes,updatedAt:new Date()}).where(and(eq(reservations.restaurantId,input.restaurantId),eq(reservations.id,c.reservationId)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.reservation.updated",entityType:"reservation",entityId:c.reservationId,oldValue:{tableId:before.tableId,startsAt:before.startsAt.toISOString(),endsAt:before.endsAt.toISOString(),partySize:before.partySize},newValue:{tableId:c.tableId,startsAt:c.startsAt.toISOString(),endsAt:c.endsAt.toISOString(),partySize:c.partySize},requestId:input.audit.requestId});return{id:c.reservationId};});}

  private setReservationStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="SET_RESERVATION_STATUS")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.select({id:reservations.id,status:reservations.status}).from(reservations).where(and(eq(reservations.restaurantId,input.restaurantId),eq(reservations.id,c.reservationId))).for("update").limit(1);if(!row)throw new DomainError("NOT_FOUND","Rezervasyon bulunamadı.",{httpStatus:404});assertReservationTransition(row.status as ReservationWorkflowStatus,c.status);await tx.update(reservations).set({status:c.status,updatedAt:new Date()}).where(and(eq(reservations.restaurantId,input.restaurantId),eq(reservations.id,row.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.reservation.status_changed",entityType:"reservation",entityId:row.id,oldValue:{status:row.status},newValue:{status:c.status},requestId:input.audit.requestId});return{id:row.id,status:c.status};});}

  /**
   * Attaches a takeaway or courier request to a real order.
   *
   * This is the bridge to the rest of the restaurant. A fulfillment request on
   * its own is a booking: it knows who ordered what and where it goes, but the
   * kitchen screen, the till, payments and refunds are all anchored to an
   * order, and none of them will invent a second version of themselves for
   * this. Linking hands the request to the machinery that already exists
   * instead of building a parallel one beside it.
   *
   * Once linked, the order is the money. The request keeps the delivery
   * details — address, courier state — and stops being a second opinion on
   * what the customer owes.
   */
  private linkFulfillmentOrder(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {
    const c = input.command;
    if (c.command !== "LINK_FULFILLMENT_ORDER") throw new Error("Unexpected command");
    return this.db.transaction(async (tx) => {
      const [request] = await tx.select({ id: fulfillmentRequests.id, status: fulfillmentRequests.status, orderId: fulfillmentRequests.orderId }).from(fulfillmentRequests).where(and(eq(fulfillmentRequests.restaurantId, input.restaurantId), eq(fulfillmentRequests.id, c.fulfillmentId))).for("update").limit(1);
      if (!request) throw new DomainError("NOT_FOUND", "Paket/teslimat kaydı bulunamadı.", { httpStatus: 404 });
      // The unique index would refuse a second link anyway; this says why.
      if (request.orderId) throw new DomainError("CONFLICT", "Bu paket kaydı zaten bir siparişe bağlı.", { httpStatus: 409 });
      if (request.status === "DELIVERED" || request.status === "CANCELLED") throw new DomainError("CONFLICT", "Kapanmış paket kaydı siparişe bağlanamaz.", { httpStatus: 409 });

      const [order] = await tx.select({ id: orders.id, status: orders.status, orderNumber: orders.orderNumber }).from(orders).where(and(eq(orders.restaurantId, input.restaurantId), eq(orders.id, c.orderId))).for("update").limit(1);
      if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
      if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new DomainError("CONFLICT", "Kapanmış sipariş paket kaydına bağlanamaz.", { httpStatus: 409 });
      const [taken] = await tx.select({ id: fulfillmentRequests.id }).from(fulfillmentRequests).where(and(eq(fulfillmentRequests.restaurantId, input.restaurantId), eq(fulfillmentRequests.orderId, c.orderId))).limit(1);
      if (taken) throw new DomainError("CONFLICT", "Bu sipariş başka bir paket kaydına bağlı.", { httpStatus: 409 });

      await tx.update(fulfillmentRequests).set({ orderId: order.id, updatedAt: new Date() }).where(and(eq(fulfillmentRequests.restaurantId, input.restaurantId), eq(fulfillmentRequests.id, request.id)));
      await tx.insert(auditLogs).values({ restaurantId: input.restaurantId, actorUserId: input.audit.actorStaffId, action: "erp.fulfillment.order_linked", entityType: "fulfillment_request", entityId: request.id, newValue: { orderId: order.id, orderNumber: order.orderNumber }, requestId: input.audit.requestId });
      return { id: request.id, orderNumber: order.orderNumber };
    });
  }

  private setFulfillmentStatus(input: Parameters<ErpWorkspaceRepository["execute"]>[0]) {const c=input.command;if(c.command!=="SET_FULFILLMENT_STATUS")throw new Error("Unexpected command");return this.db.transaction(async tx=>{const [row]=await tx.select({id:fulfillmentRequests.id,status:fulfillmentRequests.status}).from(fulfillmentRequests).where(and(eq(fulfillmentRequests.restaurantId,input.restaurantId),eq(fulfillmentRequests.id,c.fulfillmentId))).for("update").limit(1);if(!row)throw new DomainError("NOT_FOUND","Paket/teslimat kaydı bulunamadı.",{httpStatus:404});assertFulfillmentTransition(row.status as FulfillmentWorkflowStatus,c.status);await tx.update(fulfillmentRequests).set({status:c.status,updatedAt:new Date()}).where(and(eq(fulfillmentRequests.restaurantId,input.restaurantId),eq(fulfillmentRequests.id,row.id)));await tx.insert(auditLogs).values({restaurantId:input.restaurantId,actorUserId:input.audit.actorStaffId,action:"erp.fulfillment.status_changed",entityType:"fulfillment_request",entityId:row.id,oldValue:{status:row.status},newValue:{status:c.status},requestId:input.audit.requestId});return{id:row.id,status:c.status};});}
}
