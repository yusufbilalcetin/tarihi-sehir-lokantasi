/**
 * The single place that decides which rows a maintenance job may ever delete.
 *
 * This is a *technical* lifecycle policy, not a legal one. No tax, accounting,
 * commercial-record or KVKK retention period is encoded here; business history
 * is simply kept forever until an explicitly verified policy says otherwise.
 *
 * The rule the rest of the system relies on: a table is deletable only if it
 * appears in `AUTO_DELETABLE_TABLES`. Everything else is denied by
 * construction, and a foundation test proves the financial and history tables
 * can never drift onto that list.
 */

export const RETENTION_CATEGORIES = [
  /** A. Money and what was sold. Reports must still answer for it in 10 years. */
  "PERMANENT_BUSINESS_HISTORY",
  /** B. Operational record: who did what, when, and how service ran. */
  "LONG_TERM_OPERATIONAL_HISTORY",
  /** C. Purely technical rows with a finished lifecycle. */
  "TRANSIENT",
  /** D. Configuration and master data; soft-deleted, never row-deleted. */
  "MASTER_DATA",
  /** E. Security/abuse-control state with its own expiry column. */
  "SECURITY_TECHNICAL",
  /** F. Delivery queue rows that reach a terminal state. */
  "EVENT_QUEUE",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

/** The cleanup operations the maintenance service actually implements. */
export const MAINTENANCE_OPERATIONS = [
  "EXPIRED_RATE_LIMITS",
  "EXPIRED_IDEMPOTENCY_KEYS",
  "PROCESSED_OUTBOX_EVENTS",
] as const;

export type MaintenanceOperation = (typeof MAINTENANCE_OPERATIONS)[number];

export type AutoDeletePolicy =
  | {
      readonly mode: "NEVER";
      /** Why this table is kept, in the terms the business would use. */
      readonly reason: string;
    }
  | {
      readonly mode: "CONDITIONAL";
      readonly operation: MaintenanceOperation;
      /**
       * Extra days kept *after* the row's own expiry/terminal timestamp. Zero
       * means the table's existing expiry semantics are already the contract.
       */
      readonly graceDays: number;
      /** The condition in prose; the SQL lives with the operation. */
      readonly condition: string;
    };

export interface TableRetentionPolicy {
  readonly table: string;
  readonly category: RetentionCategory;
  readonly purpose: string;
  readonly growthDriver: string;
  /** True when the row carries `restaurant_id` and belongs to one tenant. */
  readonly tenantScoped: boolean;
  /** True when losing the row would change a financial or historical answer. */
  readonly historyDependency: boolean;
  readonly autoDelete: AutoDeletePolicy;
  /** Set when the table looks unused; documentation only, never a DROP. */
  readonly note?: string;
}

const never = (reason: string): AutoDeletePolicy => ({ mode: "NEVER", reason });

/**
 * Phase 38 ERP data is protected by default. Inventory movements, recipe
 * versions, supplier balances, attendance and loyalty entries answer past
 * operational or financial questions, while the remaining rows are live
 * master/configuration data. No legal retention period is guessed here.
 */
const ERP_PROTECTED_TABLES: readonly {
  readonly table: string;
  readonly category: RetentionCategory;
  readonly purpose: string;
  readonly historyDependency: boolean;
}[] = [
  { table: "warehouses", category: "MASTER_DATA", purpose: "Inventory storage locations.", historyDependency: true },
  { table: "inventory_items", category: "MASTER_DATA", purpose: "Inventory item catalogue and unit contract.", historyDependency: true },
  { table: "stock_movements", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Append-only inventory quantity and cost ledger.", historyDependency: true },
  { table: "stock_counts", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Physical inventory count headers.", historyDependency: true },
  { table: "stock_count_lines", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Expected, counted and variance quantities.", historyDependency: true },
  { table: "recipe_versions", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Versioned production recipe headers.", historyDependency: true },
  { table: "recipe_ingredients", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Versioned operational recipe quantities.", historyDependency: true },
  { table: "production_batches", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Daily production plan and completion history.", historyDependency: true },
  { table: "waste_records", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Waste, staff meal and complimentary consumption history.", historyDependency: true },
  { table: "suppliers", category: "MASTER_DATA", purpose: "Supplier master records.", historyDependency: true },
  { table: "supplier_items", category: "MASTER_DATA", purpose: "Supplier-to-inventory purchasing catalogue.", historyDependency: true },
  { table: "purchase_orders", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Procurement commitments and state history.", historyDependency: true },
  { table: "purchase_order_items", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Ordered and received procurement quantities.", historyDependency: true },
  { table: "goods_receipts", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Auditable goods receipt events.", historyDependency: true },
  { table: "goods_receipt_items", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Goods receipt quantity and price history.", historyDependency: true },
  { table: "supplier_invoices", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Operational supplier payable documents.", historyDependency: true },
  { table: "supplier_payments", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Supplier payment ledger.", historyDependency: true },
  { table: "attendance_records", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Server-timestamped staff attendance history.", historyDependency: true },
  { table: "staff_schedules", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Planned staff schedule history.", historyDependency: true },
  { table: "payroll_entries", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Provider-neutral payroll input ledger.", historyDependency: true },
  { table: "customer_feedback", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Anonymous order/table feedback and moderation state.", historyDependency: true },
  { table: "reservations", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Reservation and no-show history.", historyDependency: true },
  { table: "fulfillment_requests", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Takeaway and delivery fulfillment history.", historyDependency: true },
  { table: "fulfillment_request_items", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Priced takeaway and delivery lines; the amounts a fulfilled order was charged at.", historyDependency: true },
  { table: "customer_accounts", category: "MASTER_DATA", purpose: "Optional customer account and consent record.", historyDependency: true },
  { table: "customer_order_links", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Authorized customer account to order links.", historyDependency: true },
  { table: "loyalty_ledger", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Append-only loyalty point ledger.", historyDependency: true },
  { table: "popular_product_snapshots", category: "LONG_TERM_OPERATIONAL_HISTORY", purpose: "Bounded sales-derived popularity read model.", historyDependency: false },
  { table: "integration_connections", category: "MASTER_DATA", purpose: "Provider-neutral integration configuration without credentials.", historyDependency: true },
  { table: "external_transactions", category: "PERMANENT_BUSINESS_HISTORY", purpose: "Idempotent external operation and reconciliation history.", historyDependency: true },
];

export const DATA_RETENTION: readonly TableRetentionPolicy[] = [
  ...ERP_PROTECTED_TABLES.map((entry): TableRetentionPolicy => ({
    ...entry,
    growthDriver: "Restaurant operations and explicit manager configuration.",
    tenantScoped: true,
    autoDelete: never(
      "Phase 38 ERP records are retained because deleting them would change a historical answer or break live master-data references.",
    ),
  })),
  {
    table: "restaurants",
    category: "MASTER_DATA",
    purpose: "Tenant root record.",
    growthDriver: "One row per restaurant; effectively static.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Every historical row in the system references it."),
  },
  {
    table: "staff_profiles",
    category: "MASTER_DATA",
    purpose: "Staff identity, role and Supabase Auth link.",
    growthDriver: "One row per staff member; grows with hiring, not with sales.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Orders, payments, refunds, voids and audit rows attribute actions to it; " +
        "departures are handled with is_active/deleted_at, never a row delete.",
    ),
  },
  {
    table: "categories",
    category: "MASTER_DATA",
    purpose: "Menu grouping.",
    growthDriver: "One row per menu category.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Products reference it under an ON DELETE RESTRICT FK; soft-deleted instead."),
  },
  {
    table: "products",
    category: "MASTER_DATA",
    purpose: "Sellable catalogue item.",
    growthDriver: "One row per product, plus edits in place.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "order_items reference the product under ON DELETE RESTRICT. Sold names and " +
        "prices are snapshotted on the order line, so a delisted product keeps its " +
        "sales history, but the row itself stays and is soft-deleted.",
    ),
  },
  {
    table: "category_translations",
    category: "MASTER_DATA",
    purpose: "Localized category display names and descriptions.",
    growthDriver: "Categories x configured menu locales.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: never(
      "Localized category content is live master data and follows its category lifecycle through the tenant-safe foreign key.",
    ),
  },
  {
    table: "product_translations",
    category: "MASTER_DATA",
    purpose: "Localized product display names and descriptions.",
    growthDriver: "Products x configured menu locales.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: never(
      "Localized product content is live master data and follows its product lifecycle through the tenant-safe foreign key.",
    ),
  },
  {
    table: "restaurant_tables",
    category: "MASTER_DATA",
    purpose: "Physical table plus its QR token hash.",
    growthDriver: "One row per table.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Orders and waiter calls reference it under ON DELETE RESTRICT."),
  },
  {
    table: "restaurant_counters",
    category: "MASTER_DATA",
    purpose: "Monotonic per-tenant order sequence.",
    growthDriver: "One row per counter name per restaurant.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Deleting a counter restarts order numbering and would collide with the " +
        "unique order sequence of existing history.",
    ),
  },
  {
    table: "orders",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "One guest round: totals, applied tax/service rates, lifecycle timestamps.",
    growthDriver: "orders_per_day x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Sales history. Every revenue figure in every report derives from it."),
  },
  {
    table: "order_items",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "Sold lines with product name and unit price snapshots, plus VOID metadata.",
    growthDriver: "orders_per_day x avg_items_per_order x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Product-level sales history and the only record of what was sold at what price."),
  },
  {
    table: "kitchen_tickets",
    category: "LONG_TERM_OPERATIONAL_HISTORY",
    purpose: "Per-order kitchen ticket with preparation timestamps.",
    growthDriver: "At most one row per order.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Operational history; no code path deletes it and none should."),
    note:
      "UNUSED / LEGACY CANDIDATE: no runtime write path was found. The kitchen " +
      "report derives PREPARING -> READY timing from order_events instead. " +
      "Reported only; the table is deliberately not dropped.",
  },
  {
    table: "waiter_calls",
    category: "LONG_TERM_OPERATIONAL_HISTORY",
    purpose: "Waiter calls and bill requests, including who acknowledged and resolved them.",
    growthDriver: "calls_per_day x 365 x years; small next to order_items.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Resolved calls carry staff attribution and response timing, and the " +
        "service-request history is part of the operational record.",
    ),
  },
  {
    table: "order_events",
    category: "LONG_TERM_OPERATIONAL_HISTORY",
    purpose: "Append-only order timeline: status changes, item events, payment events.",
    growthDriver: "orders_per_day x avg_events_per_order x 365 x years. The fastest-growing table.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "The order timeline UI reads it, and the kitchen report pairs PREPARING -> " +
        "READY from it. Deleting old events would silently empty historical reports.",
    ),
  },
  {
    table: "payments",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "Collected money: amount, method, actor, and the refunded-amount cache.",
    growthDriver: "orders_per_day x avg_payments_per_order x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "The financial ledger. It also carries the permanent payment idempotency " +
        "key hash, so deleting a row would re-open a settled request to replay.",
    ),
  },
  {
    table: "payment_refunds",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "Money returned, with reason code, note and actor.",
    growthDriver: "refunds_per_day x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Gross, refunded and net are only separately provable while both sides " +
        "exist. It also carries the permanent refund idempotency key hash.",
    ),
  },
  {
    table: "order_checks",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "One printable bill of a split party.",
    growthDriver: "split_orders_per_day x checks_per_order x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("Payments reference the check they settled; it is part of the bill record."),
  },
  {
    table: "order_check_items",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "How much of an order line belongs to a check, with its price snapshot.",
    growthDriver: "Roughly order_items on split orders.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never("The line-level detail of a printed bill."),
  },
  {
    table: "cash_registers",
    category: "MASTER_DATA",
    purpose: "A physical or logical till that shifts are opened on.",
    growthDriver: "One row per register; effectively static.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Every historical shift references it under ON DELETE RESTRICT. A retired " +
        "till is deactivated, and the shift keeps its own name snapshot so an " +
        "old report never loses the register it was rung on.",
    ),
  },
  {
    table: "cashier_shifts",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose:
      "One cashier's cash accountability period: opening float, collections, " +
      "refunds, drawer movements, counted cash and the variance.",
    growthDriver: "registers x shifts_per_day x 365 x years; small but permanent.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "The cash record. Payments and refunds are attributed to it, the counted " +
        "drawer and its variance exist nowhere else, and a closed shift carries " +
        "its operational Z report as a frozen snapshot that is never recomputed.",
    ),
  },
  {
    table: "cashier_shift_cash_counts",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose:
      "The physically counted drawer, one row per denomination and phase: what " +
      "a named cashier counted, in which currency, at which face value.",
    growthDriver: "denominations x currencies x phases x shifts_per_day x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "The evidence behind an opening float and a closing variance. Deleting a " +
        "row would leave a shift total that nothing in the system can account " +
        "for, and cash discrepancies are investigated long after the day ends.",
    ),
  },
  {
    table: "cash_drawer_movements",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "Cash into or out of the drawer for reasons other than a payment or refund.",
    growthDriver: "movements_per_shift x shifts_per_day x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Each row is part of the expected-cash arithmetic of a shift that has " +
        "already been counted and signed off. Deleting one would make a closed " +
        "shift's variance unexplainable.",
    ),
  },
  {
    table: "printer_agents",
    category: "SECURITY_TECHNICAL",
    purpose:
      "A local print agent's identity and its hashed, revocable bearer token.",
    growthDriver: "One row per agent machine; effectively static.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Print jobs and delivery attempts reference the agent that handled them, " +
        "and the token digest is a security record. A retired agent is revoked " +
        "and deactivated, never deleted.",
    ),
  },
  {
    table: "restaurant_printers",
    category: "MASTER_DATA",
    purpose: "A printer as the cloud knows it, plus its paper and code-page profile.",
    growthDriver: "One row per printer; effectively static.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Print jobs reference it under ON DELETE RESTRICT, and every job also " +
        "snapshots its name so history reads correctly after a rename. A " +
        "retired printer is deactivated.",
    ),
  },
  {
    table: "printer_routes",
    category: "MASTER_DATA",
    purpose: "Which printer a document type, optionally narrowed to a category, goes to.",
    growthDriver: "A handful of rows per restaurant.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: never(
      "Live configuration. A job records its destination when it is created, " +
        "so changing a route never rewrites work already queued.",
    ),
  },
  {
    table: "print_jobs",
    category: "LONG_TERM_OPERATIONAL_HISTORY",
    purpose:
      "One queued document with its immutable payload snapshot and delivery state.",
    growthDriver: "tickets_per_order x orders_per_day x 365 x years, plus reprints.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "What was asked for and what reached a printer, including every reprint " +
        "and its stated reason. Phase 8C deliberately adds no cleanup: a real " +
        "retention period for print history is a decision nobody has made yet.",
    ),
  },
  {
    table: "print_job_attempts",
    category: "LONG_TERM_OPERATIONAL_HISTORY",
    purpose: "Each delivery attempt for a print job, with its sanitised outcome.",
    growthDriver: "attempts_per_job x print_jobs; usually one, more when a printer fails.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "The evidence for whether a ticket was delivered, and how often it had " +
        "to be retried. Removing it would leave a duplicate at the pass " +
        "unexplainable.",
    ),
  },
  {
    table: "restaurant_settings",
    category: "MASTER_DATA",
    purpose: "Per-tenant feature flags, tax and service rates.",
    growthDriver: "Exactly one row per restaurant.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: never("Live configuration; orders snapshot the rates they were opened with."),
  },
  {
    table: "audit_logs",
    category: "PERMANENT_BUSINESS_HISTORY",
    purpose: "Security and financial investigation trail of staff actions.",
    growthDriver: "audited_mutations_per_day x 365 x years.",
    tenantScoped: true,
    historyDependency: true,
    autoDelete: never(
      "Item cancellations record their acting staff member nowhere else, so the " +
        "review report reads this table directly. It is also the security record.",
    ),
  },
  {
    table: "outbox_events",
    category: "EVENT_QUEUE",
    purpose: "Transactional outbox for realtime publication.",
    growthDriver: "One row per published domain event; the highest-churn technical table.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: {
      mode: "CONDITIONAL",
      operation: "PROCESSED_OUTBOX_EVENTS",
      graceDays: 7,
      condition:
        "status = 'PUBLISHED' and published_at <= cutoff. PENDING, PROCESSING, " +
        "FAILED and dead-lettered rows are never touched: they still need " +
        "delivery or an explicit manual retry.",
    },
  },
  {
    table: "idempotency_keys",
    category: "SECURITY_TECHNICAL",
    purpose: "Request replay protection for order creation and item additions.",
    growthDriver: "idempotent_requests_per_day; bounded by its own 24-hour TTL.",
    tenantScoped: true,
    historyDependency: false,
    autoDelete: {
      mode: "CONDITIONAL",
      operation: "EXPIRED_IDEMPOTENCY_KEYS",
      graceDays: 7,
      condition:
        "expires_at <= cutoff. An expired key is already treated as a brand-new " +
        "request by the order service (it restarts the record), so removing it " +
        "changes no behaviour. Payment and refund duplicate protection does not " +
        "live here: it is a permanent unique index on payments.metadata and " +
        "payment_refunds.metadata, which this operation cannot reach.",
    },
  },
  {
    table: "api_rate_limits",
    category: "SECURITY_TECHNICAL",
    purpose: "Fixed-window abuse-control counters keyed by HMAC digest.",
    growthDriver: "Active limiter keys; bounded by the longest policy window.",
    tenantScoped: false,
    historyDependency: false,
    autoDelete: {
      mode: "CONDITIONAL",
      operation: "EXPIRED_RATE_LIMITS",
      graceDays: 0,
      condition:
        "expires_at <= cutoff, matching the opportunistic delete the limiter " +
        "already performs on every request. A window whose expires_at is still " +
        "in the future is active and is never removed.",
    },
  },
];

export const RETENTION_BY_TABLE: ReadonlyMap<string, TableRetentionPolicy> = new Map(
  DATA_RETENTION.map((policy) => [policy.table, policy]),
);

/** The complete allow-list. Anything absent here can never be auto-deleted. */
export const AUTO_DELETABLE_TABLES: readonly string[] = DATA_RETENTION.filter(
  (policy) => policy.autoDelete.mode === "CONDITIONAL",
).map((policy) => policy.table);

export const PROTECTED_TABLES: readonly string[] = DATA_RETENTION.filter(
  (policy) => policy.autoDelete.mode === "NEVER",
).map((policy) => policy.table);

export function retentionOf(table: string): TableRetentionPolicy {
  const policy = RETENTION_BY_TABLE.get(table);
  if (!policy) throw new Error(`[Retention] No policy is declared for table "${table}".`);
  return policy;
}

/** Batch bounds. Deliberately modest: a maintenance job must not stall writes. */
export const MAINTENANCE_BATCH = {
  default: 500,
  minimum: 1,
  maximum: 5_000,
  /** Safety stop so one invocation cannot run unbounded. */
  defaultMaxBatches: 20,
  maximumMaxBatches: 1_000,
} as const;

export function assertBatchSize(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MAINTENANCE_BATCH.minimum ||
    value > MAINTENANCE_BATCH.maximum
  ) {
    throw new TypeError(
      `[Maintenance] Batch size must be an integer between ${MAINTENANCE_BATCH.minimum} and ${MAINTENANCE_BATCH.maximum}.`,
    );
  }
  return value;
}

export function assertMaxBatches(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAINTENANCE_BATCH.maximumMaxBatches) {
    throw new TypeError(
      `[Maintenance] Maximum batch count must be an integer between 1 and ${MAINTENANCE_BATCH.maximumMaxBatches}.`,
    );
  }
  return value;
}

/**
 * A pending outbox event older than this has not been delivered by any
 * scheduler run and is an operational alert, never a cleanup candidate.
 */
export const OUTBOX_STALE_PENDING_HOURS = 6;
