# Security foundation

This document records the security boundary for the central restaurant backend.
It is a rollout contract, not evidence that the database policies are already
deployed. Supabase Auth is authoritative whenever its public configuration is
present; the legacy HMAC session remains behind one compatibility boundary only
for installations where Supabase is entirely unconfigured.

## Runtime configuration

Environment validation is lazy and capability-scoped. Importing a module does
not require credentials, so local UI builds can continue while the backend is
being provisioned. A code path that needs a capability must call its strict
accessor and fail closed.

| Variable | Exposure | Required by | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | server only | database/migrations | PostgreSQL URL; use the pooler URL where appropriate |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase clients | HTTPS except local Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Supabase browser/server clients | `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted temporarily |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | trusted admin jobs | Bypasses RLS; never use in UI or ordinary request handlers |
| `QR_TOKEN_PEPPER` | server only | QR validation | At least 32 bytes; rotate with an explicit QR reissue migration |
| `AUTH_SECRET` | server only | customer table session | At least 32 bytes and distinct from `STAFF_SESSION_SECRET` and every other secret |
| `RATE_LIMIT_KEY_SECRET` | server only | abuse controls | HMAC key for privacy-preserving shared-store identities; at least 32 bytes |
| `OUTBOX_DISPATCH_SECRET` | server only | outbox worker endpoint | Protected scheduler bearer secret; at least 32 bytes |
| `CRON_SECRET` | server only | unused by the current scheduler | The Supabase cron job sends `OUTBOX_DISPATCH_SECRET` directly. This variable only matters if a Vercel cron is ever added, and it would then have to repeat `OUTBOX_DISPATCH_SECRET` exactly |
| `MAINTENANCE_SECRET` | server only | data-maintenance endpoint | Protected scheduler bearer secret; at least 32 bytes and **must differ from `OUTBOX_DISPATCH_SECRET`** — it authorises row deletion |
| `PRINTER_AGENT_TOKEN_PEPPER` | server only | printer agent authentication | HMAC pepper for agent bearer tokens; at least 32 bytes and **distinct from every other secret** — never reuse `OUTBOX_DISPATCH_SECRET`, `MAINTENANCE_SECRET` or `AUTH_SECRET` |
| `SUPABASE_STORAGE_BUCKET` | server only | product image storage | Optional; defaults to `product-images` |
| `LOG_LEVEL` | server only | logging | `debug`, `info`, `warn`, or `error` |

Generate unrelated secrets independently, for example with
`openssl rand -base64 48`. Never copy a service-role key into a `NEXT_PUBLIC_*`
variable. Public variables are frozen into browser bundles at build time.

## QR lifecycle

1. Generate 32 cryptographically random bytes and encode them as unpadded
   base64url (43 characters).
2. Return the raw token only to the QR generation operation. Do not log it or
   write it to the database.
3. Store `v1.<HMAC-SHA256>` produced with `QR_TOKEN_PEPPER` and the QR-specific
   domain separator.
4. Resolve `/menu/<raw-token>` by hashing the candidate and comparing fixed-size
   digests with a constant-time comparison.
5. Check `restaurants.is_active` and `tables.is_active` in the same query scope.
6. Issue the short-lived, table-bound `sehir_table_session` after validation.
   Its signed claims include codec version, restaurant, table, expiry, nonce, and the table's
   revocable access version. Order,
   waiter-call, and bill endpoints must derive restaurant/table IDs from that
   session, not from request JSON.
7. Reissue/rotate a table token on suspected disclosure. Old hashes become
   invalid immediately; QR rotation is an audited admin action.

The structured logger masks keys containing token, QR, cookie, authorization,
PIN, password, service-role, or secret, and also scrubs common secret forms from
free text. Callers should log `qrTokenHashFingerprint(tokenHash)` when a safe
correlation value is needed.

## PostgreSQL RLS strategy

Enable RLS on every restaurant-owned table, including storage metadata exposed
through Supabase. A staff user must have an active membership row matching both
`auth.uid()` and the row's `restaurant_id`. Policies must distinguish read and
mutation permissions; membership alone must not grant admin actions.

- Customer menu reads go through narrowly scoped backend/RPC functions that
  return only active categories/products for the validated restaurant.
- Order creation runs in one server-side Drizzle transaction. It derives prices
  and availability from locked product rows, then creates the order, item
  snapshots, lifecycle event, outbox event, and idempotency result atomically.
- Staff status mutations verify allowed role and status transition in the
  database transaction, not only in UI.
- The Supabase service-role client is restricted to migrations, controlled
  background jobs, and exceptional server administration. Route handlers use
  the server-only Drizzle connection after authorization, and every repository
  query still carries `restaurant_id`; RLS remains a second boundary for
  browser Supabase reads rather than a substitute for service-layer scoping.
- Every query and uniqueness rule is restaurant-scoped. Cross-restaurant IDs
  should produce not-found/forbidden without revealing record existence.

Policy tests must create two restaurants and prove that each role cannot read,
update, subscribe to, or download the other's resources.

## Realtime channels

Use private channels named by non-secret IDs:

- `restaurant:<restaurantId>` for public menu availability events
- `restaurant:<restaurantId>:staff` for staff operations
- `restaurant:<restaurantId>:table:<tableId>` for a validated table session
- `restaurant:<restaurantId>:order:<orderId>` for an order owner/session

Never use a raw QR token as a topic. Realtime authorization must query active
restaurant membership or the table-bound session. Database changes publish a
minimal DTO after commit; clients invalidate/update server-state caches. Do not
publish PII, auth claims, internal notes, hashes, or whole database rows.

Phase 3 implements the staff path as a **private** Broadcast channel. The
outbox worker claims rows with `FOR UPDATE SKIP LOCKED`, reclaims stale locks,
publishes a field-allowlisted envelope with a stable event id, and marks the row
`PUBLISHED` only after Supabase acknowledges the REST broadcast. Failed sends
return to `FAILED` with bounded exponential backoff. Once 50 actual delivery
failures have been recorded, the row is terminal and needs operator review;
worker crashes do not consume a delivery attempt. Delivery is at least once, so
clients de-duplicate by `eventId` and then refresh authoritative API state.

A scheduler invokes `/api/internal/outbox/dispatch` with
`Authorization: Bearer <OUTBOX_DISPATCH_SECRET>`. `POST` and `GET` are the same
authenticated handler behind the same constant-time bearer check — the
scheduler uses `POST`, and `GET` stays for compatibility with schedulers that
can only issue that verb; it is no more reachable without the secret than
`POST`. The endpoint is server-only, no-store, and returns only delivery
counters. Never expose this secret to the browser or configure the dispatcher
as an unauthenticated public cron.

The schedule itself lives in Supabase infrastructure, not in this repository:
`vercel.json` declares no cron, and no application code path dispatches the
outbox. A missing or misconfigured scheduled job fails silently — the API keeps
answering while realtime stops and the backlog grows.

Only the service-role outbox transport publishes. Authenticated browser clients
receive topics matching their active `staff_profiles.restaurant_id`; no
`realtime.messages` INSERT policy is granted to browsers. Channels must be
created with `{ config: { private: true } }`, and Supabase Dashboard's Realtime
"Allow public access" setting must be disabled. The customer table session is
not a Supabase Auth identity, so customer table/order channels remain closed
until a separately scoped short-lived Realtime authorization mechanism exists.

References: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization),
[Broadcast](https://supabase.com/docs/guides/realtime/broadcast).

## Storage

`product-images` is a public catalog bucket: menu image URLs may be cached and
downloaded without a signed session, while bucket listing and all writes stay
closed. Create the bucket as **Public** in Supabase Dashboard with a 5 MiB file
limit and only AVIF/JPEG/PNG/WebP MIME types. RLS allows metadata SELECT and
INSERT/UPDATE/DELETE only to active `ADMIN` or `MANAGER` members whose
restaurant UUID is the first path segment. A public bucket intentionally makes
an exact object URL world-readable; it does not make object listing public.
`restaurant-assets` remains private. Staff from another restaurant cannot list
or mutate paths even if they guess a name. If `SUPABASE_STORAGE_BUCKET` is
changed from `product-images`, add an equivalent bucket-specific policy
migration before deploying the change.

Server validation allows AVIF, JPEG, PNG, and WebP, with a 5 MiB input limit.
Verify decoded image content and dimensions before publishing; MIME and file
extension alone are insufficient. Generate paths from trusted restaurant and
entity IDs, never an uploaded filename. Strip metadata, resize, and encode
optimized derivatives in a background job.

References: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Storage bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Storage schema safety](https://supabase.com/docs/guides/storage/schema/design).

## Rate limiting and abuse controls

Production limits use the central PostgreSQL `api_rate_limits` table as an
atomic shared fixed-window store, not per-instance memory. Development may use
a process-local fallback only while `DATABASE_URL` is absent. Keys are HMACed
and combine action, restaurant, table/customer session, and a
privacy-preserving client-address fingerprint.

| Action | Starting policy | Additional control |
| --- | --- | --- |
| Staff login | 5 attempts / 15 min in both IP-only and IP+identifier buckets | generic error and structured rejection/rate-limit logs |
| QR validation | 30 / min per IP | reject malformed tokens before DB lookup |
| Create order | 5 / min per table session | required idempotency key, one in-flight request |
| Waiter call | 1 open call/type/table; 30 sec cooldown | unique partial index/open-call transaction |
| Bill request | 1 open request/table; 2 min cooldown | resolve before another request |
| Image upload | 20 / hour per staff user | byte/type/dimension checks |

Return `429` with `Retry-After`; do not silently claim success. Rate limiting is
defense in depth and does not replace database constraints or idempotency.
Each database consumption also removes a bounded batch of expired limiter rows,
so attacker-controlled identifier cardinality cannot create permanent records.

## Request and logging boundary

- Validate every route body, params, and headers before business logic.
- Re-authorize inside every mutation and scope every database operation to
  `restaurant_id`.
- Mutating cookie-authenticated routes enforce same-origin/CSRF policy.
- Return stable public error codes/messages and keep stack traces server-side.
- Status/QR administration mutations attach a validated or generated request ID
  to their audit record. Structured logs use stable event names and deliberately
  omit request bodies, cookies, authorization headers, QR/customer tokens, PINs,
  database URLs, and Supabase keys.
- Audit critical changes in an append-only table with actor, restaurant, action,
  entity, before/after safe values, request ID, and timestamp.

## Required dependencies and rollout

The Supabase adapters require direct production dependencies
`@supabase/supabase-js` and `@supabase/ssr`. Generate database TypeScript types
after migrations exist and parameterize all clients with those generated types.

Supabase request-proxy refresh, active profile mapping, domain role guards, and
tenant-scoped API authorization are active. Tenant APIs deliberately reject
legacy sessions. Remove the compatibility provider only after every deployed
staff identity is linked through `staff_profiles.auth_user_id` and rollback/
parity tests pass.

Supabase SSR Auth cookies share `Path=/`, `SameSite=Lax`, and production
`Secure=true`. They intentionally remain `HttpOnly=false` because the official
Supabase browser client refreshes its cookie-backed session; every privileged
server boundary still calls `auth.getUser()` and resolves an active scoped
profile. The independently signed customer table cookie is `HttpOnly=true`.

## Phase 4: live panels, payments and admin CRUD

Staff panels subscribe to the private Supabase Realtime topic
`restaurant:<restaurantId>:staff` through one shared hook, so a panel holds a
single connection regardless of how many lists it renders. Delivery is
at-least-once, so the hook de-duplicates by outbox `eventId` and treats every
event as a change signal only: the panel always re-reads the REST API, which
stays the single source of truth. Each (re)connect triggers a full resync, and a
polling fallback keeps the panels correct when Realtime is unavailable.

Customers have no Supabase identity, so they are deliberately **not** given a
Realtime channel. A table-scoped topic would have to be either public (guessable
from two UUIDs) or backed by an anonymous JWT; both widen the customer trust
boundary for little gain. Instead the menu and active-order views revalidate
through the HttpOnly table-session cookie on focus, on visibility change, and on
a short interval. Sold-out and price changes therefore reach the guest without a
page refresh while every read stays cookie-authorized and tenant-scoped.

Payments are a single transaction: the order row is locked, the total is read
from the database (never from the request), one payment row is written, the
order is closed, and the event/audit trail is appended. A partial unique index
on `(restaurant_id, order_id)` for `PENDING`/`COMPLETED` payments is the final
guard against double collection, and the `Idempotency-Key` header replays the
original receipt instead of charging twice.

Admin menu, table, settings and staff mutations run through the shared
`ADMIN`/`MANAGER` route envelope: trusted origin, re-authorized principal,
restaurant-scoped repository access, audit record, and outbox event. Staff
account creation provisions the Supabase auth user first and deletes it again if
the profile insert fails, so a failure never leaves a half-provisioned login.
Product images are stored under a server-generated,
restaurant-scoped path; the object is removed again if the database write fails.

Outbox events that exhaust their retries are marked with `dead_lettered_at`
instead of being retried forever. They stop being claimed and are recoverable
only through the explicit admin requeue endpoint.

## Phase 5: staff table quick actions

The six table-card shortcuts are ordinary authenticated mutations; none of them
introduces a second write path. Order confirmation and serving reuse
`PATCH /api/orders/[orderId]/status`, and clearing a request reuses
`PATCH /api/staff/calls/[callId]`, so the table card, the orders screen and the
calls screen drive the same transitions and therefore cannot disagree. Two
capabilities are new: `POST /api/staff/calls` opens a service request from a
staff device, and `POST /api/staff/orders` lets a waiter take an order at the
table. `GET /api/staff/menu` serves that order pad the same catalog the guest
sees, resolved from the staff principal's tenant rather than a table session.

`lib/domain/table-actions.ts` decides which shortcuts a role may see. It is a
pure policy shared by the panel and the Phase 5 tests, and it is advisory only:
every rule is re-derived server-side, so hiding a control never becomes the
authorization. Roles follow the existing model — `ADMIN`, `MANAGER` and
`WAITER` may open orders, the call handlers additionally include `CASHIER`
restricted to bill requests, and `KITCHEN` reaches none of the table-card
mutations.

Duplicate suppression is a database property, not a UI guard. The partial
unique index over `(restaurant_id, table_id, type)` for `OPEN`/`ACKNOWLEDGED`
rows means a second tap on "Hesap" replays the existing request with `200`
instead of creating a parallel one; a lost insert race re-reads the winning row
rather than failing. Staff orders carry the same `Idempotency-Key` contract as
guest orders, and the order pad keeps one key across retries of an unchanged
cart, so a failed-then-retried send cannot produce two orders.

A staff order is created by `OrderService` in the guest transaction: prices,
service charge, tax and total are computed from locked product rows and the
request body carries only product ids and quantities. Only the creator and the
session preconditions differ — a waiter has no QR session, so the table token
version is not checked, and the guest-facing `orderingEnabled` switch does not
block staff from taking orders. The row is written with
`created_by_type = 'STAFF'` and the acting profile id, and a staff order also
writes an audit record, which the anonymous guest path does not.

Table notes reuse `waiter_calls` with type `OTHER` and the `Masa notu` request
label rather than adding a parallel annotation table. A note is deliberately
not a service call: it never repaints `restaurant_tables.current_status` and is
not counted as an open waiter call on the dashboard. It publishes
`TABLE_NOTE_ADDED`; staff-opened waiter calls and bill requests keep the guest
event names `WAITER_CALLED` and `BILL_REQUESTED`, and every creation writes an
audit record with the acting profile id and the request id.

Phase 5 needs no migration. `order_creator_type` already contained `STAFF` and
the active-call unique index already existed, so the schema carried both
capabilities before the endpoints did.

Phase 5 deliberately does not close a table or settle a bill. Nothing here
writes a payment or a `COMPLETED` order; the Phase 4 payment workflow remains
the only path to a paid order.

## Phase 6: service-time order and table operations

Phase 6 adds the corrections a real service needs — appending a later round,
cancelling a line or a whole order, moving a party, merging two tables and
clearing a settled one — without introducing a second write path. Order money is
still only ever derived by `OrderService` inside one transaction, and payment
remains the sole route to a paid order.

`lib/domain/order-mutations.ts` and `lib/domain/table-operations.ts` hold the
policies. They are pure, shared by the panels and the tests, and advisory only:
every rule is re-derived server-side, so a hidden button is never the
authorization.

A round may grow only while the kitchen has not finished it — `NEW`,
`CONFIRMED` or `PREPARING`. `READY`, `SERVED`, `COMPLETED` and `CANCELLED`
return `ORDER_NOT_MUTABLE` and the waiter opens a new order on the same table
instead. This is deliberate: the order status is never silently rewound, and an
item added to a `READY` order would land in a stage the kitchen cannot advance.
Appended lines enter as `PENDING` and nothing already prepared is reset, so the
existing item-level lifecycle carries the late round on its own.

Prices are read at the moment of the addition. A line sold at the old price
keeps it and the new line snapshots today's, exactly as order creation does.
Because a later settings change must not re-price a round the guest already
agreed to, `orders.service_fee_rate` and `orders.tax_rate` now travel with the
order and every recalculation uses them; rows written before this column existed
fall back to the restaurant settings.

Cancellation is soft. `order_items` rows are never deleted — the status becomes
`CANCELLED`, `cancelled_at` is stamped, and the order money is rebuilt from the
surviving lines. Who may cancel depends on how far the kitchen has gone:
`PENDING` is ordinary waiter work, `PREPARING` and `READY` carry a cost and need
a manager, and a `SERVED` line is refused with `ITEM_CANNOT_BE_CANCELLED`
because it needs a void, which this phase does not build. Whole-order
cancellation is manager-only and follows the same forward-only status map, so a
served order is refused there too. Any order with a settled payment returns
`ORDER_ALREADY_COMPLETED`, and one with a payment in flight returns `CONFLICT`.
A reason is mandatory from a fixed preset, `Diğer` additionally requires a
bounded explanation, and both land in the audit metadata rather than in a new
column.

Table moves run in one transaction that locks both tables in a single
id-ordered statement, so two devices moving the same pair in opposite directions
cannot deadlock. Transfer refuses an occupied target and names the merge
operation instead; merge exists precisely for the occupied case and keeps every
order's own id and number, so a merged table shows two rounds rather than one
rewritten order. If the number of rows actually moved differs from the number
read under the lock, the whole operation aborts rather than moving a subset.
Because the database allows one active request per `(table, type)`, a source
request whose type the target already has open is resolved and audited instead
of colliding with that unique index.

Table status is derived, never set by a client: a bill request outranks a waiter
call, which outranks merely having an open order, and a table note is not a
service call at all. Reset only clears a table that has no open order, no unpaid
served order, no pending payment and no open request; each blocker returns
`TABLE_RESET_BLOCKED`. There is deliberately no manager override — every blocker
is a financial or service record, and the way to clear one is to finish it.

A table move does not touch the QR token or the guest's signed table session.
The old session stays bound to the old table and simply stops seeing the moved
order; it is never silently re-pointed at the new table. Guests rescan the QR at
their new table, which keeps the Phase 3 customer trust boundary intact.

Phase 6 publishes `ORDER_ITEMS_ADDED`, `ORDER_ITEM_CANCELLED`,
`TABLE_TRANSFERRED`, `TABLES_MERGED` and `TABLE_RESET` through the existing
outbox, each with its own field allowlist; table events carry ids, numbers and a
moved-order count only. Audit actions are `staff.order.items_added`,
`order.item.cancelled`, `order.cancelled`, `table.transferred`, `table.merged`
and `table.reset`.

Migration `0008` is additive: two order-event enum values and the two nullable
rate columns. Nothing is dropped or narrowed.

## Phase 8A: cashier shifts and the cash drawer

Every collection and refund is attributed to the acting staff member's own
**open cash shift**, resolved server-side from the authenticated principal. The
request body carries no shift field and the schemas are `.strict()`, so a
client cannot name the drawer its money lands in, cannot reach another
cashier's shift, and cannot reach another tenant's. Without an open shift the
collection and refund endpoints answer `CASHIER_SHIFT_REQUIRED`; disabling the
button in the till screen is convenience, not the control.

Role matrix: `CASHIER`, `MANAGER` and `ADMIN` may run a till, record drawer
movements and close their own shift. `MANAGER` and `ADMIN` may additionally
close somebody else's shift — which always requires a note and is audited as
its own action — and are the only roles that may manage registers. `WAITER` and
`KITCHEN` are forbidden throughout. A cashier asking about a colleague's shift
receives the same `NOT_FOUND` as for a shift that does not exist.

Two database-level invariants carry the concurrency guarantees rather than
application checks:

- partial unique indexes give one `OPEN` shift per register and one per staff
  member, so two simultaneous open requests cannot both win;
- a check constraint ties `status` to the closing columns and requires
  `cash_variance = counted_cash_at_close − expected_cash_at_close`, so a closed
  shift cannot be reopened, blanked or quietly re-counted even through direct
  SQL.

Closing takes the shift's row lock, and so does every payment, refund and
drawer movement attributed to it. That single ordering is what makes the close
snapshot honest: an in-flight collection either commits first and is counted,
or arrives afterwards and is refused. A shift holding a `PENDING` payment
cannot close at all, because its expected cash is not yet knowable. Open orders
elsewhere in the restaurant never block a close — a shift is an accountability
period, not a table lifecycle.

Expected cash is always server-derived:

```text
opening + cash collected − cash refunded + cash in − cash out
```

Card money belongs to the shift's accountability but never to the drawer, so it
moves neither the expectation nor the count. A refund is attributed to the
shift that gave the money back, not the (often already closed) shift that
collected it, so a historical shift's snapshot can never change retroactively.

`cash_registers`, `cashier_shifts` and `cash_drawer_movements` hold **no**
grants for `anon` or `authenticated` and have row-level security enabled, so a
signed-in cashier cannot read or write them through the Data API — every
mutation goes through the server. Migration `0010` also revokes the
`REFERENCES`/`TRIGGER`/`TRUNCATE` privileges that migration `0009` left on
`payment_refunds`, `order_checks` and `order_check_items` by inheriting
Supabase's schema defaults; `TRUNCATE` in particular is not constrained by RLS.

The maintenance endpoint's secret and the outbox scheduler's secret remain
distinct, and neither cash table is reachable by the retention job: both are
classified as permanent business history.

Migration `0010` is additive: two enums, three tables, two nullable
`cashier_shift_id` columns with composite tenant foreign keys, and their
indexes. Historical payments and refunds keep `NULL` there, meaning
LEGACY / PRE-SHIFT, and are never back-filled with an invented shift.

## Phase 8B: operational X/Z and end-of-day cash reporting

**These reports are not fiscal documents.** There is no ÖKC, no fiscal printer,
no EFT-POS integration, no e-Arşiv and no e-Fatura behind them. An X report is
the restaurant's own live view of an open drawer; a Z report is its own final
record of one closed drawer. Every rendered and exported copy carries the line
*"Bu rapor operasyonel kasa mutabakatıdır; mali cihaz/ÖKC Z raporu değildir."*
Nothing in the product may present them as an official or tax Z report.

**X is derived; Z is stored.** An X report is recomputed from live rows on every
request and is genuinely side-effect free: it writes nothing, leaves the shift
`OPEN`, and never blocks a collection. A Z report is built inside the closing
transaction, from the same summary the close decided on, and written in the same
`UPDATE` — so a `CLOSED` shift without its report cannot exist, and a duplicate
cannot either, because only an `OPEN` row can be closed. Reading a Z report
parses the stored snapshot; it is never recomputed. A refund issued by a later
shift therefore changes that shift's drawer and leaves the earlier report
byte-identical.

Snapshots are versioned. A snapshot written by a newer build is refused rather
than parsed against today's field list, and one that fails validation raises an
internal error instead of rendering as a report with missing figures. Shifts
closed before this phase have no snapshot; that state is explicit
(`LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT`) and no report is reconstructed for them.

Role matrix: a `CASHIER` may read the X and Z reports of their own shifts only —
a colleague's shift answers the same `NOT_FOUND` as one that does not exist.
`MANAGER` and `ADMIN` may read any shift in their restaurant and are the only
roles that may read the end-of-day report, which aggregates the whole
restaurant. `WAITER` and `KITCHEN` are forbidden throughout.

The end-of-day report covers one **restaurant-local calendar day**, and scopes
every figure by the transaction's own timestamp rather than by the shift's
close time, so a drawer running past midnight contributes each collection to
the day it was taken on. No business-day cutoff (04:00 and the like) is
invented; that remains an unmade product decision. Its query schema is
`.strict()`, so a `restaurantId` on the query string is rejected outright — the
tenant comes from the session through the shared admin envelope.

CSV export is server-side and reuses `lib/domain/csv.ts`: every cell that begins
with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an
apostrophe, so an operator-supplied register name, cashier name or note can
never execute as a spreadsheet formula. Names occupy cells of their own rather
than being concatenated into labels, so the escaper sees them at the start of a
value. Money is exported as the exact decimal it is stored as, never
locale-formatted. In Phase 8B printing was `window.print()` against a print
stylesheet and no printer transport existed; Phase 8C adds a thermal path
alongside it (see below and `docs/printing.md`). The browser print route is
unchanged and remains the A4 copy.

Migration `0011` is additive: three nullable columns on `cashier_shifts`, one
partial index and one check constraint. No table is added, so the retention
classification stays at 23 tables and `cashier_shifts` remains permanent
business history that the maintenance job cannot reach.


## Phase 8C: adisyon, kitchen tickets and the print queue

Full design in `docs/printing.md`. The security boundary, in short:

**Nothing printed is fiscal.** The adisyon, the payment slip and X/Z are
informational documents and each carries its own printed non-fiscal notice.
There is no ÖKC, no EFT-POS integration, no e-Arşiv and no e-Fatura.

**Printer command injection is impossible from the API side.** The request body
names a document type and a source id and never its contents; the server reads
the source from the database, composes the snapshot and renders the ESC/POS
bytes itself. `printRequestBodySchema` is a `.strict()` discriminated union with
no payload field, so there is no route by which caller-supplied text becomes a
printer command. Free text that does reach the paper (product names, notes,
register names) is sanitised first: control characters are removed and layout
whitespace collapses to a single space.

**Agent credentials are their own thing.** An agent is not a browser session:
no cookie, no CSRF surface, no staff principal. It presents a bearer token of 32
random bytes, compared in constant time against a stored
`v<n>.<HMAC-SHA256>` digest computed with `PRINTER_AGENT_TOKEN_PEPPER` and a
printing-specific domain separator. The raw token is returned exactly once, at
creation or rotation — never logged, never written to an audit payload, never
returned again, never exposed to the browser. A lost token is rotated, not
recovered. A malformed, unknown, revoked or deactivated credential all answer
the same 401, so the surface reveals nothing about which agents exist, and
revocation takes effect on the next call because the lookup selects only
active, unrevoked rows.

**The agent holds no database access.** No `DATABASE_URL`, no
`SUPABASE_SERVICE_ROLE_KEY`, no `postgres://` string. It connects outbound only
and opens no inbound port in the restaurant. A foundation test reads the agent
source and asserts all of this, and also that the agent composes no printer
commands of its own.

**No card data is printed or stored.** No full PAN, CVV, expiry, PIN or
processor secret appears in a print payload or on paper.

**Printing never participates in a financial decision.** Enqueuing is a row
insert on the order's own transaction — no socket, no timeout. A printer that
is off cannot roll back an order, a payment or a shift close, and no print
outcome is ever an input to money. `PRINTED` records that the bytes reached the
transport, not that paper physically exists; the limitation is stated in the UI
and in `docs/printing.md`.

**Reprints are additive and explained.** A reprint is a new row carrying the
original snapshot, pointing at its original, with a mandatory reason enforced by
both validation and a check constraint. The original job is never rewritten.

Role matrix: `ADMIN`/`MANAGER` administer agents, printers, routes, the queue,
retries and reprints, and are the only roles that may trigger a test print
(it reaches a physical device on demand). `CASHIER` may print the adisyon, the
payment slip and its own shift's X/Z. `WAITER` may print the adisyon.
`KITCHEN` may read ticket status only, and is refused the bill, the payment
slip and the test print.

The five printing tables have RLS enabled and **zero grants** to `anon` and
`authenticated`; a signed-in manager can neither read a job, read a token
digest, queue paper directly, rewrite a job, nor delete print history. Every
one of those is asserted against a real Supabase Auth session in
`tests/integration/phase8c-printing-rls.integration.test.ts`.

Migration `0012` is additive: five new tables, their enums, indexes and check
constraints, plus the hand-written `REVOKE`/RLS addendum. The retention
classification grew to 28 tables **at that point** (it now covers all 61 —
see `lib/config/data-retention.ts`); `print_jobs` and `print_job_attempts` are
long-term operational history that the maintenance job cannot reach.


## Phase 8D: staff accounts, user management and secure bootstrap

**Supabase Auth stays authoritative.** No parallel authentication system was
added, no password, PIN or hash column exists on `staff_profiles`, and no
schema in `lib/validation/admin-staff.ts` accepts one. The credential belongs to
the provider; the role, the tenant and the history belong to the profile.

**Who may manage whom.** The rules live in `lib/domain/staff-accounts.ts` as
pure functions, so the disabled button in the panel and the 403 from the route
are the same decision:

| Actor | May create/manage | Refused |
| --- | --- | --- |
| `ADMIN` | every role, including other administrators | — |
| `MANAGER` | `WAITER`, `KITCHEN`, `CASHIER` | `ADMIN` and `MANAGER`, in either direction |
| `CASHIER` / `WAITER` / `KITCHEN` | nobody | the whole surface, including the listing |

Nobody changes their own role or switches off their own account, in any role.

**The last administrator is protected.** A restaurant may never be left without
one: deactivating, archiving or demoting the last active `ADMIN` is refused —
by another administrator too. The count is taken inside the update transaction
with `SELECT … FOR UPDATE` over the admin rows, so two administrators standing
each other down at the same moment cannot both pass the check; the second waits
and then reads the first one's committed result. Proven with real parallel
requests.

**Creation is atomic across two systems.** The auth user is created first and
the profile second, because only that order can be undone: a failure in the
profile deletes the login it was made for, and an integration test forces
exactly that window and asserts zero orphaned auth users. Two parallel
creations of the same address produce exactly one account.

**No password crosses the boundary.** Accounts are created **without** one; the
holder sets their own through a password-setup link. The panel's only password
action is asking the provider to send that link again, rate limited per target
(`STAFF_PASSWORD_RESET`, 3 per 15 minutes). No link, token or temporary password
is ever returned to the browser, written to the audit trail or logged.

**Deactivation and role changes take effect on the next request.** The principal
is resolved from the database on every request, scoped by `auth_user_id`,
`is_active`, `deleted_at is null` and an active restaurant — there is no cached
claim to wait out. A deactivated account is refused even with correct
credentials, and the provider's user is left intact rather than deleted, because
orders, payments, refunds and shifts point at that staff row.

**No hard delete.** There is no `DELETE` route for a staff profile. Accounts are
deactivated, and history keeps pointing at them by id and by name snapshot.

**Direct Data API writes are impossible.** `authenticated` holds `SELECT` and
nothing else on `staff_profiles`; a signed-in manager cannot promote themselves,
promote a colleague, insert a forged profile or delete one. Each is asserted
against a real Supabase Auth session.

**Bootstrap is terminal-only.** There is no `/api/setup`, no
`?makeMeAdmin=true`, and no web route that grants an admin role. The first
administrator of a restaurant is created with
`npm run staff:bootstrap -- --restaurant <slug> --name "…" --email …`, which
refuses to run when the restaurant already has an active administrator unless
`--allow-additional-admin` is given, and refuses a password on the command line
outright (shell history is not a credential store). It prints a one-time
password-setup link and stores nothing.

### Email delivery is NOT verified

The Supabase TEST project has **no custom SMTP configured**. Its built-in sender
returns `over_email_send_rate_limit` (HTTP 429) for password-setup requests, so
in this environment **no setup email is delivered**. The API call is reported
honestly: `passwordSetupEmailRequested` means the provider accepted the request,
never that a message arrived, and the panel says so in as many words.

Until custom SMTP is configured, onboarding uses the terminal:
`npm run staff:setup-link -- --email personel@ornek.com` prints a one-time
setup link for an existing active staff member. The link is deliberately not
available in the browser panel — it is a credential in link form.

### Where the setup link lands, and why not the provider's own link

`generateLink` returns an `action_link` that points at the provider's verify
endpoint, which redirects to the project's Site URL and leaves a *recovery
session* in the browser. This application must not accept that:
`resolveStaffPrincipal` turns any valid Supabase session for an active profile
into a full staff principal, so such a link would be panel access for anyone
holding it, without a password ever being chosen.

So the CLI ignores `action_link` and builds its own from
`properties.hashed_token`:

    ${APP_BASE_URL}/staff/set-password?token_hash=…

`app/(auth)/staff/set-password` only renders a form — opening the link neither
signs anyone in nor spends the token. `POST /api/staff/set-password` redeems it
with `verifyOtp` on a client built `persistSession: false`, calls
`updateUser({ password })` and discards the session, so **no auth cookie is ever
written by this flow**. The request carries a token and a password and nothing
else, so it cannot change a role, a restaurant or an account's active state.
`APP_BASE_URL` must be set to the deployment origin; it defaults to
`http://localhost:3000`.

The token is one-time. A password the provider refuses still spends it, and the
response says so rather than inviting a retry that can no longer succeed.

**For the emailed path**, point the Supabase *Reset Password* email template at
the same page instead of `{{ .ConfirmationURL }}`:

    {{ .SiteURL }}/staff/set-password?token_hash={{ .TokenHash }}

That is a dashboard change, like SMTP itself, and is not inferred from
repository code.

**Configuring SMTP in the Supabase project is a production prerequisite**, and
email verification settings must be confirmed in the dashboard; nothing about
them is inferred from repository code.

## Content Security Policy: the remaining `unsafe-inline`

`next.config.ts` serves a static CSP whose `script-src` still carries
`'unsafe-inline'`. Nothing currently exploits it — the only inline script in the
app is a fixed string in `app/menu/[tableToken]/page.tsx`, every other sink goes
through React's escaping, and no user-controlled HTML is rendered anywhere — so
this is defence in depth, not an open hole. It is recorded here because closing
it is a deliberate migration, not an edit.

### Why the static header cannot simply drop it

Next.js emits its own inline bootstrap and streaming payload scripts on every
page. Removing `'unsafe-inline'` without giving those scripts another way to
execute stops hydration outright: the page renders and then never becomes
interactive. Only two mechanisms replace it, and the version shipped here
(`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`)
documents both:

- **Nonce via `proxy.ts`.** Next.js parses the request's CSP header, extracts
  `'nonce-…'`, and attaches it automatically to framework scripts, page bundles
  and its own inline scripts. Requires dynamic rendering.
- **Experimental SRI** (`experimental.sri`). Keeps static generation, but hashes
  only build-time assets; it does not cover the framework's inline scripts, so
  `'unsafe-inline'` would have to stay. It is also marked experimental and may be
  removed. It does not solve this problem.

Nonce is therefore the only real option.

### What it costs here

The generic warning about nonces disabling static generation is mild for this
app, because the panels are already dynamic. A production build shows only three
HTML routes that would change:

| Route | Today | After nonce |
| --- | --- | --- |
| `/staff/login` | static | dynamic, needs `await connection()` |
| `/menu/invalid` | static | dynamic, needs `await connection()` |
| `/_not-found` | static | dynamic |

The 21 panel and menu routes are already `ƒ`. `icon.png`, `apple-icon.png` and
`manifest.webmanifest` are not HTML and are unaffected.

### The proxy change, and the trap in it

`proxy.ts` currently matches only the protected panels plus `/menu/:path*`. A
nonce has to reach every HTML response, so the matcher must widen — and that is
the risky part, because the same file is the authentication gate.

Two properties must hold and must be re-proved after any edit:

1. `/staff/login` stays outside `isProtectedStaffPath()`. It is absent from
   `PROTECTED_STAFF_PREFIXES` today only by omission; once the matcher includes
   it, that omission becomes load-bearing against a redirect loop.
2. The CSP header is attached to *every* branch that returns — the auth
   redirect, the invalid-menu redirect and the menu-gate response each build
   their own `NextResponse`, and a nonce header set on only the happy path
   leaves those pages with no policy at all.

### Verification protocol before this ships

Do not merge the change on a green `next build` alone; a hydration failure builds
perfectly. Required, in a staging environment pointed at a disposable database:

1. `npm run lint`, `npx tsc --noEmit`, `npm run test:foundation`.
2. `npm run build` and confirm the three routes above moved to `ƒ`.
3. `npm run start`, then in a browser with devtools open:
   - load `/staff/login`, submit a wrong credential, confirm the error renders
     (proves React hydrated, not just painted);
   - load a real `/menu/<token>` QR URL and add an item to the cart;
   - load `/admin/dashboard` and confirm charts render and polling refreshes;
   - confirm the console shows **zero** `Refused to execute inline script`
     violations on all three.
4. Confirm `Content-Security-Policy` on each response contains a *different*
   `nonce-` value per request.

Only after step 4 passes on every route should `'unsafe-inline'` be removed from
`script-src`. `style-src` is a separate decision: Tailwind ships a stylesheet,
but inline `style` attributes are used in several components, so it keeps
`'unsafe-inline'` until those are audited independently.
