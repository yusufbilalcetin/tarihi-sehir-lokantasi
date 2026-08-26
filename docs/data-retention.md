# Data retention and technical lifecycle

This document describes what the system keeps, what a scheduled job is allowed
to delete, and why. It is a **technical** lifecycle policy.

> **No legal retention period is encoded anywhere in this codebase.** Turkish
> tax, accounting, commercial-record and KVKK retention requirements have not
> been verified and are deliberately not guessed at. Business history is simply
> kept indefinitely.
>
> **LEGAL RETENTION PERIOD REQUIRES VERIFIED POLICY** — before any rule such as
> "delete after N years" is introduced, the period must come from a verified
> legal source and be approved as a business decision.

The machine-readable source of truth is `lib/config/data-retention.ts`. The
prose here follows it; if the two disagree, the code wins and this file is
wrong.

## The one rule

A table can be auto-deleted **only** if it is declared `CONDITIONAL` in
`lib/config/data-retention.ts`. Everything else is denied by construction, and
`tests/foundation/phase7f-data-retention.test.ts` fails if a financial or
history table ever appears on the allow-list.

| | Tables |
| --- | --- |
| **Automatic deletion allow-list** | `api_rate_limits`, `idempotency_keys`, `outbox_events` (published rows only) |
| **Automatic deletion deny-list** | the other 20 tables |

There is **no** DELETE-based retention for `orders`, `order_items`,
`payments`, `payment_refunds`, `order_checks`, `order_check_items`,
`audit_logs`, `order_events`, `cashier_shifts` or `cash_drawer_movements`.
Master data is soft-deleted (`deleted_at` / `is_active`), never row-deleted.

## Classification of all 23 public tables

### A. Permanent business history

Reports must still answer for these in ten years. Retention: **PERMANENT**.

| Table | Purpose | Growth driver |
| --- | --- | --- |
| `orders` | One guest round: totals, applied tax/service rates, lifecycle timestamps | `orders_per_day × 365 × years` |
| `order_items` | Sold lines with product-name and unit-price snapshots, plus VOID metadata | `orders_per_day × items_per_order × 365 × years` |
| `payments` | Collected money: amount, method, actor, refunded-amount cache | `orders_per_day × payments_per_order × 365 × years` |
| `payment_refunds` | Money returned, with reason code, note and actor | `refunds_per_day × 365 × years` |
| `order_checks` | One printable bill of a split party | `split_orders_per_day × checks_per_order × 365 × years` |
| `order_check_items` | Per-line allocation of a check, with its price snapshot | ≈ `order_items` on split orders |
| `audit_logs` | Security and financial investigation trail of staff actions | `audited_mutations_per_day × 365 × years` |
| `cashier_shifts` | One cashier's cash accountability period: float, collections, refunds, counted drawer and variance, plus the frozen operational Z report | `registers × shifts_per_day × 365 × years` |
| `cash_drawer_movements` | Cash into or out of the drawer outside payments and refunds | `movements_per_shift × shifts_per_day × 365 × years` |

`audit_logs` deserves a specific note: **item cancellations record their acting
staff member nowhere else**, so `report-detail-service.ts` reads this table
directly to build the review report. Deleting old audit rows would silently
empty historical reports, not merely lose a debug trail.

### B. Long-term operational history

Retention: **PERMANENT** (no automatic deletion designed).

| Table | Purpose | Growth driver |
| --- | --- | --- |
| `order_events` | Append-only order timeline: status changes, item events, payment events | `orders_per_day × events_per_order × 365 × years` — the fastest-growing table |
| `waiter_calls` | Waiter calls and bill requests, with acknowledge/resolve attribution | `calls_per_day × 365 × years` |
| `kitchen_tickets` | Per-order kitchen ticket with preparation timestamps | ≤ 1 row per order |

`order_events` is explicitly **not** subject to aggressive cleanup. The order
timeline UI reads it, and the Phase 7C kitchen report derives
`PREPARING → READY` timing from it because `kitchen_tickets` is not written at
runtime.

`kitchen_tickets` — **UNUSED / LEGACY CANDIDATE.** No runtime write path was
found for it. It is reported here and **deliberately not dropped**: dropping a
table is a schema decision with no upside in this phase, and the report path it
was intended for already works from `order_events`.

### C. Transient / cleanable

Only `outbox_events` in its terminal state; see section F.

### D. Configuration / master data

Retention: **PERMANENT**, with soft delete where a lifecycle exists.

| Table | Soft delete | Why hard delete is not used |
| --- | --- | --- |
| `restaurants` | `is_active` | Every historical row references it |
| `staff_profiles` | `is_active`, `deleted_at` | Orders, payments, refunds, voids and audit rows attribute actions to it |
| `categories` | `is_active`, `deleted_at` | Products reference it under `ON DELETE RESTRICT` |
| `products` | `is_active`, `deleted_at` | `order_items` reference it under `ON DELETE RESTRICT` |
| `restaurant_tables` | `is_active` | Orders and waiter calls reference it under `ON DELETE RESTRICT` |
| `restaurant_counters` | — | Deleting a counter restarts order numbering and would collide with the unique order sequence of existing history |
| `restaurant_settings` | — | Live configuration; orders snapshot the rates they were opened with |
| `cash_registers` | `is_active`, `deleted_at` | Every historical shift references it under `ON DELETE RESTRICT`; the shift also snapshots the register's name, so a rename cannot rewrite an old report |

A delisted product keeps its sales history because `order_items` stores
`product_name_snapshot` and `unit_price` at the time of sale. The catalogue row
still stays: the FK is `RESTRICT`, so a hard delete would fail anyway, and
succeeding would be worse.

### E. Security / rate limit / idempotency

| Table | Auto-delete | Condition |
| --- | --- | --- |
| `api_rate_limits` | ✅ `EXPIRED_RATE_LIMITS` | `expires_at <= now()`, grace **0 days** |
| `idempotency_keys` | ✅ `EXPIRED_IDEMPOTENCY_KEYS` | `expires_at <= now() − 7 days` |

**Rate limits.** The grace is zero because that is already the contract: the
limiter itself deletes up to 100 expired rows on every request
(`lib/security/rate-limit.server.ts`). The maintenance job is a backstop for
keys that stop being hit. A window whose `expires_at` is in the future is
active and is never removed.

**Idempotency keys.** The TTL is 24 hours (`order-service.ts`), and an expired
record is already treated as a brand-new request — the service *restarts* it
rather than replaying it. Deleting an expired row therefore changes no
behaviour. Seven days of grace is kept anyway, purely as margin.

**Payment and refund idempotency does not live in this table.** It is a
permanent partial unique index on `payments.metadata->>'idempotencyKeyHash'`
and `payment_refunds.metadata->>'idempotencyKeyHash'`. Those rows are permanent
business history, so a retried payment can never produce a second collection no
matter how long ago the original happened, and the maintenance job cannot reach
that protection at all.

### F. Event / queue data

| Table | Auto-delete | Condition |
| --- | --- | --- |
| `outbox_events` | ✅ `PROCESSED_OUTBOX_EVENTS` | `status = 'PUBLISHED' and published_at <= now() − 7 days` |

Never deleted, at any age:

- `PENDING` — not yet dispatched
- `PROCESSING` — claimed by a worker, possibly a stale lock to be reclaimed
- `FAILED` — in retry backoff
- `dead_lettered_at is not null` — retries exhausted, awaiting an explicit
  manual retry via `requeueDeadLettered`

An old undelivered event is an **alert**, not a cleanup candidate. The health
report flags pending events older than 6 hours under `needsAttention`.

## The maintenance service

`lib/services/data-maintenance-service.ts`

| Property | Behaviour |
| --- | --- |
| Scope | **Global system maintenance.** Not tenant-scoped: `api_rate_limits` has no `restaurant_id`, and the other two tables hold infrastructure state rather than tenant data, so a per-restaurant mode would be a half-truth. |
| Dry run | `dryRun: true` counts candidates and deletes nothing. It is the default of the HTTP surface. |
| Batching | `batchSize` (default 500, 1–5000) and `maxBatches` (default 20, 1–1000), both validated. A short batch ends the loop. |
| Concurrency | Each batch selects `FOR UPDATE SKIP LOCKED`, so two schedulers take disjoint rows instead of deadlocking or double-counting. |
| Idempotence | A second run over a clean backlog reports `scanned: 0, deleted: 0` and succeeds. |
| Failure isolation | Each operation is caught individually and reports its own `error`; the run continues and returns per-operation results. |
| Audit | A run returns `startedAt / finishedAt / dryRun / operations[] / errors[]`. It deliberately does **not** write an `audit_logs` row per deleted technical row. |

## The maintenance endpoint

`app/api/internal/maintenance/route.ts`, protected by `MAINTENANCE_SECRET`
(server-only, ≥32 bytes, `Authorization: Bearer <value>`).

- `GET` — health/observability. Database internals (exact sizes, queue depths)
  are never exposed on a public or customer-facing endpoint.
- `POST` — retention cleanup. `dryRun` defaults to **true**; deletion must be
  requested explicitly with `{"dryRun": false}`.

`MAINTENANCE_SECRET` must differ from `OUTBOX_DISPATCH_SECRET`; environment
validation rejects reuse. A scheduler credential that only publishes events
must not also authorise row deletion. Never prefix either with `NEXT_PUBLIC_`.

The endpoint is scheduler-agnostic (Supabase cron, Vercel cron or any external
scheduler that can send a header). No hosting provider is assumed.

**There is no admin-UI button for destructive cleanup**, by design.

## Long-term reporting

- Sales history is retained in full.
- Historical snapshots (product name, unit price, applied tax/service rates,
  check line prices) are retained on the rows themselves.
- Reports aggregate **server-side** in SQL (`sum`, `count`, `group by`); the
  browser never downloads raw historical rows.
- Technical transient cleanup is entirely separate from business history and
  cannot touch it.

Cashier shifts add a second, narrower financial record on top of the order
ledger: what one person was accountable for at one till between two moments. A
closed shift is a frozen snapshot — its expected cash, counted cash and
variance are written once, inside the closing transaction, and are never
recomputed. A refund issued tomorrow belongs to tomorrow's drawer and must not
alter yesterday's count.

**Profit is not reported and must not be claimed.** There is no inventory,
recipe or cost snapshot in the schema, so only *gross sales* and *net
collected* exist. Neither may be labelled "profit" without a cost model.

### Known long-term query risk

`report-detail-service.ts` (`getReviewDetails`) and the product report in
`report-analytics-service.ts` materialise the full result set for the selected
period into memory and paginate with `Array.slice`. Within a 30-day period this
is unremarkable, but `SINCE_SYSTEM_START` and `CUSTOM` ranges have no upper
bound, so at multi-year scale these two paths would load a large row set per
request. Everything else aggregates in SQL.

**Not changed in Phase 7F** (it is a report refactor, not a retention change).
It is recorded here as the next thing to fix if report latency grows.

## Open product decision

**PRODUCT DECISION REQUIRED: should partially paid tables/orders be
mergeable?**

Current behaviour, deliberately unchanged: a partially paid order can be
merged, `payments.order_id` does not move, and the ledger stays correct. This
is not a financial-integrity or security defect — every collected amount
remains attributed to the order it was collected against. It is simply a
product question that has not been answered.
