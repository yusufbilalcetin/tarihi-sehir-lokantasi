# Long-term capacity notes

How large this database gets over 2, 5 and 10 years, and what that depends on.

Companion documents: `docs/data-retention.md` (what is kept and what may be
deleted), `docs/database-recovery.md` (backup and restore).

## Measured baseline

Measured on the Supabase project this repository is configured against, with
migrations `0000`–`0009` applied and no business data.

| Metric | Value |
| --- | --- |
| `pg_database_size(current_database())` | ~14.9 MB (≈14 MB) |
| Migration ledger rows | 10 |
| `public` tables | 20 |
| Business rows | 0 |

Largest tables by `pg_total_relation_size` on the empty database:

| Table | Total | Heap | Indexes |
| --- | --- | --- | --- |
| `audit_logs` | 262 KB | 32 KB | 229 KB |
| `outbox_events` | 238 KB | 66 KB | 172 KB |
| `products` | 229 KB | 49 KB | 180 KB |
| `order_events` | 205 KB | 66 KB | 139 KB |
| `orders` | 147 KB | 49 KB | 98 KB |
| `staff_profiles` | 147 KB | 49 KB | 98 KB |

> **This is not a production forecast.** The TEST database holds no business
> data; almost all of the ~14 MB is PostgreSQL catalogue and extension
> overhead, and every "largest table" figure above is empty-index overhead. The
> only thing it establishes is a floor.

Note what the ranking already shows: **indexes dominate.** On this schema index
storage is routinely three to four times the heap. Any capacity estimate that
counts only row bytes will be badly low.

## Measured average row widths

`avg(pg_column_size(t.*))` over the Phase 7F fixture, on the TEST database:

| Table | Bytes/row |
| --- | --- |
| `orders` | 172 |
| `order_items` | 152 |
| `order_events` | 119 |
| `payments` | 144 |
| `audit_logs` | 180 |
| `waiter_calls` | 136 |

**Caveat.** These come from a handful of fixture rows with short names, empty
notes and small JSON payloads. Real rows carry longer product names, guest
notes, and much larger `jsonb` payloads in `order_events.payload`,
`audit_logs.old_value/new_value` and `payments.metadata`. Treat these as a
lower bound, and re-measure on a populated database before sizing anything.

Excluded from these figures: index storage, TOAST overflow, per-page overhead,
and dead-tuple bloat between autovacuum runs.

## The capacity model

`lib/domain/data-capacity.ts` — `estimateCapacity(input, averageRowBytes?)`.

It produces **row counts** from operator-supplied volumes. It does not invent a
restaurant's volume, and it returns `null` bytes (with `bytesUnknown: true`)
unless measured row widths are supplied, rather than guessing.

Inputs: `ordersPerDay`, `averageItemsPerOrder`, `averageEventsPerOrder`,
`averagePaymentsPerOrder`, `averageCallsPerDay`, `averageAuditRowsPerOrder`,
`years`.

### Formulas

```text
annual_order_rows   = orders_per_day × 365
annual_item_rows    = orders_per_day × avg_items_per_order      × 365
annual_event_rows   = orders_per_day × avg_events_per_order     × 365
annual_payment_rows = orders_per_day × avg_payments_per_order   × 365
annual_audit_rows   = orders_per_day × avg_audit_rows_per_order × 365
annual_call_rows    = calls_per_day  × 365

rows(table, years)  = annual_rows(table) × years
```

Growth is linear in both volume and years — there is no compounding, because
nothing in the schema is retained per-period.

### Illustrative horizons

Inputs below are **illustrative only**; no real restaurant volume has been
supplied. Substitute real numbers before drawing any conclusion.

Assuming 120 orders/day, 4 items, 6 events, 1.2 payments and 2 audit rows per
order, plus 40 service calls/day, with the measured row widths above:

| Horizon | Total rows | Heap (row bytes only) |
| --- | --- | --- |
| 2 years | ~1.27 M | ~173 MB |
| 5 years | ~3.18 M | ~433 MB |
| 10 years | ~6.37 M | ~866 MB |

**Add indexes.** Given the empty-database ratio above, total on-disk size at
ten years should be expected in the low single-digit GB, not ~0.9 GB. Verify
with `pg_indexes_size` on real data rather than trusting a multiplier.

At those magnitudes PostgreSQL is comfortable, provided queries stay indexed
and aggregation stays server-side. Row count is not the risk; unbounded
queries are.

## Cash shift tables (Phase 8A)

Two permanent tables were added with the cash drawer, and neither is a growth
concern next to `order_events`:

```text
annual_shift_rows    = registers × shifts_per_day × 365
annual_movement_rows = registers × shifts_per_day × movements_per_shift × 365
```

`cash_registers` is effectively static — one row per till.

The Phase 8B operational Z report adds no table: it is a `jsonb` snapshot on
the shift row it belongs to, so it grows exactly with `cashier_shifts`:

```text
annual_z_snapshots = closed_shifts_per_day × 365
```

A snapshot is a few hundred bytes of JSON — identity, per-method breakdowns and
the closing figures. At two closed shifts a day that is well under a megabyte a
year, and it is stored inline rather than TOASTed at that size. Measure it with
`avg(pg_column_size(z_report_snapshot))` once real shifts exist rather than
trusting that estimate.

No shift volume is assumed here. A restaurant with two registers running two
shifts a day produces roughly 1,460 shift rows a year; the movement count
depends entirely on how often the till is topped up or emptied, which nobody
has measured. Substitute real figures before sizing anything.

Both tables are permanent business history: the counted drawer and its variance
exist nowhere else, so the retention maintenance job cannot reach them.

## Printing tables (Phase 8C)

Five tables were added with the print queue. Two of them are master data and
never grow; two grow with printed volume; one grows with retries.

`avg(pg_column_size(t.*))` over a disposable ten-row fixture on the TEST
database, using a realistic five-line Turkish order:

| Table | Bytes/row | Of which `payload_snapshot` |
| --- | --- | --- |
| `print_jobs` (kitchen ticket) | 688 | 466 |
| `print_jobs` (customer bill) | 968 | 750 |
| `print_job_attempts` | 120 | — |
| `restaurant_printers` | 160 | — |
| `printer_agents` | 160 | — |

`print_jobs` is the widest operational row in the schema, because it stores the
document as printed rather than a reference to it. That is deliberate: a
reprint six months later must reproduce the paper that was handed over, not
today's recomputed version of it. A twenty-line banquet order roughly triples
the payload; measure with `avg(pg_column_size(payload_snapshot))` once real
volume exists rather than trusting the figure above.

```text
annual_print_rows    = orders_per_day × (kitchen_tickets_per_order + bills_per_order) × 365
annual_attempt_rows  = annual_print_rows × average_attempts
```

`kitchen_tickets_per_order` is the number of *stations* an order touches, not
one: an order with grill and bar lines produces two tickets. Reprints and
per-course additions add more. At 150 orders a day, two stations, one bill each
and one attempt per job, that is roughly 164,000 job rows a year at ~800 bytes
— on the order of 130 MB a year before indexes, which puts it second only to
`order_events`.

`printer_routes`, `restaurant_printers` and `printer_agents` are effectively
static: a handful of rows per restaurant, changed only when hardware changes.

Both growth tables are long-term operational history and the retention
maintenance job cannot reach them — a printed ticket is evidence of what the
kitchen was told, and a failed job is evidence of what never reached the pass.
If the payload volume ever needs bounding, the answer is an explicit,
policy-driven archival decision, not an automatic delete.

## What actually grows

| Rank | Table | Driver |
| --- | --- | --- |
| 1 | `order_events` | Several events per order; append-only |
| 2 | `order_items` | Items per order |
| 3 | `print_jobs` | One per station per order, plus every bill; stores the document itself |
| 4 | `audit_logs` | Audited mutations, with `jsonb` before/after values |
| 5 | `orders` | One per guest round |
| 6 | `payments` | Split bills and multi-method collection |

`outbox_events`, `idempotency_keys` and `api_rate_limits` do **not** grow with
history: their rows have a finished lifecycle and are the only ones the
maintenance job removes (see `docs/data-retention.md`).

## Query safety at 10 years

Verified during Phase 7F:

- Report services aggregate in SQL (`sum`, `count`, `group by`,
  `to_char`/`extract` bucketing). The browser never receives raw historical
  rows.
- Report periods are calendar periods with server-side bounds, and every
  report query is filtered by `restaurant_id` plus a date range.
- Relevant existing indexes cover the long-term access paths:
  `orders_restaurant_status_created_idx`,
  `order_items_restaurant_order_status_idx`,
  `order_items_restaurant_product_idx`,
  `order_events_restaurant_order_created_idx`,
  `order_events_restaurant_type_created_idx`,
  `payments_restaurant_created_idx`,
  `payments_restaurant_order_status_idx`,
  `payment_refunds_restaurant_created_idx`,
  `audit_logs_restaurant_created_idx`,
  `audit_logs_restaurant_entity_created_idx`,
  `audit_logs_restaurant_actor_created_idx`.

**No new index was added in Phase 7F.** The existing `(restaurant_id, …,
created_at)` composites already cover the long-term report queries, and a
sequential scan on an empty TEST database is not evidence of anything. Add an
index only when a real query on production-scale data shows the existing ones
are insufficient.

### Open issue

`report-detail-service.ts` (`getReviewDetails`) and the product report in
`report-analytics-service.ts` build the whole period's result set in memory and
paginate with `Array.slice`. The `SINCE_SYSTEM_START` and `CUSTOM` presets have
no upper bound on the period, so at multi-year scale these two endpoints would
load a large row set per request. Every other report path aggregates in SQL.

Not changed in Phase 7F — it is a report refactor, not a retention change. It
is the first thing to address if report latency grows.

## Deliberately not done

**Partitioning.** `order_events` and `audit_logs` are the natural future
candidates (append-heavy, time-ordered, queried by date range). Partitioning
adds real schema and migration complexity and buys nothing at the volumes
modelled above. **Future candidate only; not introduced.**

**Archiving to files.** Financial and historical rows are never exported to CSV
and deleted. The database stays the reporting source of truth.

**Autovacuum tuning.** Supabase's managed PostgreSQL defaults are left alone.
Bloat could not be meaningfully measured on an empty TEST database, so there is
no evidence to tune against.

**`VACUUM FULL` from application cron.** Never. It takes an `ACCESS EXCLUSIVE`
lock and would take the restaurant offline.

**Scheduled manual `ANALYZE`.** Not added; autovacuum handles it. The batched
deletes in the maintenance job are small and leave no bloat worth a manual
pass.

**Automatic orphan-image cleanup.** Product images live in Supabase Storage;
the database stores only the path. Because products are *soft*-deleted and
their historical sales keep referring to them, a row that looks unreferenced
may still be in use. Deleting a live image is unrecoverable and worse than
wasting the storage, so **no orphan deletion job and no orphan-detection
endpoint exist**. If detection is ever wanted, it must be dry-run only and must
treat soft-deleted products as live references.

## Re-measuring

```sql
-- Database and table sizes, table vs index split
select c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_table_size(c.oid))          as heap,
       pg_size_pretty(pg_indexes_size(c.oid))        as indexes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- Average row width for a growth table
select avg(pg_column_size(t.*)) from order_events t;
```

Or call the maintenance health endpoint, which returns the database size, the
per-table heap/index split, the migration count and the outbox queue depth:

```bash
curl -H "Authorization: Bearer $MAINTENANCE_SECRET" \
  https://<deployment>/api/internal/maintenance
```
