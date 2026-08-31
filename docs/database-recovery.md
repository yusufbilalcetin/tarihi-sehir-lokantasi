# Database backup and recovery runbook

This is the recovery contract for the central PostgreSQL/Supabase database. It
covers what must exist before production, and what to do when something has
gone wrong.

## Honest status of managed backups

Nothing in this repository can prove which backup features are enabled on a
Supabase project: backup schedules, retention windows and point-in-time
recovery are plan-dependent project settings, not code. What follows is
therefore separated by **how each fact was established**. Nothing here may be
promoted to a stronger status without new evidence.

### Backup facts, by evidence level (as of 2026-08-31)

| Fact | Value | Evidence level |
| --- | --- | --- |
| Manual `pg_dump` export | Works end to end | **VERIFIED** — performed and checked |
| Scheduled backups | **Daily** | USER/DASHBOARD-REPORTED — not independently verified from this repository |
| Backup retention window | **7 days** | USER/DASHBOARD-REPORTED — not independently verified from this repository |
| Point-in-time recovery (PITR) | **NOT AVAILABLE** | USER/DASHBOARD-REPORTED |
| Last successful backup timestamp | — | **UNVERIFIED** — no timestamp has been confirmed |
| Storage bucket object-byte backup | — | **NOT VERIFIED** — no evidence that product-image bytes are covered by any backup |

Consequences that follow directly from the table, and nothing more:

- **PITR is not available**, so the recovery granularity is a whole scheduled
  backup, not an arbitrary timestamp. Every "PITR target" instruction below
  degrades to "the nearest scheduled backup before the incident".
- Retention being 7 days means an incident discovered more than 7 days late has
  **no managed backup to restore from**.
- Because the last successful backup timestamp is unverified, the actual data
  loss window of a restore is **not currently known** and must be read from the
  dashboard at incident time, not assumed.
- Because storage object bytes are not verified as backed up, a database
  restore must be assumed to produce a catalogue of **broken product images**
  until someone proves otherwise.

The following statements remain **unmade** by this document and must not be
copied into any other document without new evidence:

- "PITR is enabled" (the reported value is the opposite)
- "RPO is N minutes"
- "the last backup succeeded at <time>"
- "product images are backed up"

**MANAGED BACKUP CONFIGURATION STILL REQUIRES A PRODUCTION PLAN DECISION.**

### Verification checklist (still open before production)

1. Open the production Supabase project → Database → Backups.
2. Record the **last successful backup timestamp** and re-check it periodically;
   this is the one figure above that is still unverified for scheduling.
3. Confirm from the dashboard whether the plan must be upgraded to obtain PITR,
   given the recovery objective decided below.
4. Determine and record whether Storage bucket objects are covered by any
   backup, and if not, establish a separate object-byte export.
5. Re-date this section whenever any row of the table changes.

## Recovery objectives

| Objective | Value |
| --- | --- |
| RPO (maximum acceptable data loss) | **BUSINESS DECISION REQUIRED** |
| RTO (maximum acceptable downtime) | **BUSINESS DECISION REQUIRED** |

These are business decisions about a restaurant's tolerance for losing a
service period, not technical constants. They are deliberately left unset
rather than invented. Once decided, they determine whether the managed backup
plan above is sufficient.

## What must be recoverable

A database restore alone does not restore the system. All six of these must be
recoverable independently:

| Asset | Where it lives | Recovery path |
| --- | --- | --- |
| Database rows | Supabase managed PostgreSQL (17.6) | Scheduled backup (reported daily, 7-day retention) or a manual `pg_dump`. **No PITR** — see the evidence table above |
| Schema | `db/migrations/0000…` in this repository | Re-apply migrations in order with `npm run db:migrate` — **onto a Supabase project.** See the note below before restoring anywhere else. |
| Source code | Git repository | Clone at the tagged/deployed commit |
| Product images | Supabase Storage bucket (`SUPABASE_STORAGE_BUCKET`, default `product-images`) | Storage backup is **separate** from database backup and object-byte backup is **NOT VERIFIED**; assume the bytes are not covered until proven |
| Secrets and configuration | Deployment secret manager | See below |
| Auth users | Supabase Auth (`auth.users`) | Part of the managed project, not of `public` — confirm it is included in whatever restore path is chosen |
| Printer agent configuration | The restaurant's own machine (`printer-agent.config.json`) | Not in this repository and not in any backup here; the device map is re-entered on site — see `docs/printing.md` |

The database stores only the *path/reference* to a product image. Restoring the
database without the Storage bucket produces a catalogue of broken images; both
must be restored to the same point.

### Restoring onto something that is not Supabase

`npm run db:migrate` cannot bootstrap a plain PostgreSQL on its own. Migration
`0000` declares a foreign key from `staff_profiles.auth_user_id` to
`auth.users(id)` and eighteen RLS policies that call `auth.uid()`; Supabase Auth
owns both, so this repository never creates them. On a Supabase target they are
already there and the chain applies cleanly — which is the ordinary recovery
path, and the one to prefer.

If the target is a plain PostgreSQL (a rehearsal, a forensic copy, or a
provider migration), apply `scripts/rehearsal-db-shim.sql` first. It creates the
`auth` schema, a minimal `auth.users`, an `auth.uid()` and the three Supabase
roles, and refuses to run against a real project. Restoring this way gives a
database whose `public` schema is correct but whose identity surface is a stub:
staff accounts will not authenticate until they are re-attached to a real auth
provider. Treat it as a way to read and verify data, not as a running system.

**Verified 2026-08-31:** the full chain `0000 → 0019` was applied from empty
onto PostgreSQL 17.6 (matching production's server version) behind that shim,
producing 61 tables and 20 ledger rows, and a second run was a no-op. A
mid-chain failure was also observed: it left zero tables and zero ledger rows,
so a failed migration does not leave a half-built schema behind.

### Secrets

Production secrets are stored **only** in the deployment platform's secret
manager. They are never written to a backup file inside the repository, and
never committed. `.env.example` documents the variable names, never values.

Recovery of secrets means re-injecting them from the secret manager (or
re-generating and rotating them). The full list is in
`docs/security-foundation.md`; the ones without which the application cannot
start or verify existing data are:

- `DATABASE_URL`
- `QR_TOKEN_PEPPER` — **existing QR token hashes cannot be verified without the
  original value.** Losing it means reissuing every table QR code.
- `AUTH_SECRET`, `RATE_LIMIT_KEY_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`
- `OUTBOX_DISPATCH_SECRET`, `MAINTENANCE_SECRET`
- `PRINTER_AGENT_TOKEN_PEPPER` — **existing agent token digests cannot be
  verified without the original value.** Losing it means rotating every printer
  agent token and re-deploying each agent's environment; no paper is lost, but
  no agent can authenticate until it is done.

## Restore runbook

Do **not** perform any of this against production without an explicit decision
to do so. A restore is a data-loss event in its own right.

### 1. Incident detection

Establish what actually happened and when. Record the earliest known-bad
timestamp — every later step depends on it. Sources: application error rates,
the maintenance health endpoint (`GET /api/internal/maintenance`), Supabase
logs, and staff reports of missing or wrong data.

### 2. Stop / freeze writes

Decide explicitly whether to keep serving. Continuing to write past a
corruption event makes the restore point worse and can make a partial recovery
impossible. Options, in order of preference:

1. Put the deployment into maintenance mode.
2. Disable ordering per tenant (`restaurant_settings.ordering_enabled`) so
   guests cannot create new orders.
3. Accept ongoing writes and document that data after the incident will be
   lost or must be reconciled by hand.

Record the decision and the time it took effect.

### 3. Select the backup

Choose the latest backup **before** the earliest known-bad timestamp. PITR is
reported as **not available**, so there is no arbitrary target timestamp to
choose: the options are the discrete scheduled backups (reported daily,
retained 7 days) and any manual `pg_dump` taken. Read the actual last
successful backup timestamp from the dashboard — it is not known in advance
here. Record the chosen backup, its timestamp and the resulting data loss
window (backup → now), and compare it against the agreed RPO.

### 4. Restore into an isolated environment first

Restore to a **new** project or database, never over the live one. This makes
every check below non-destructive and preserves the option to abandon the
restore.

### 5. Verify schema

```bash
npx drizzle-kit check                 # migration ledger is internally consistent
```

On the restored database, confirm the following. Both counts are derived, not
memorised: a frozen number in a runbook goes stale silently, and an operator
who accepts a badly-restored database because the document told them to expect
an old figure is worse off than one with no document at all.

- **Migration ledger.** `drizzle.__drizzle_migrations` should hold one row per
  entry in `db/migrations/meta/_journal.json` at the deployed commit:

  ```bash
  node -e "console.log(require('./db/migrations/meta/_journal.json').entries.length)"
  ```
  ```sql
  select count(*) from drizzle.__drizzle_migrations;
  ```

  A ledger *behind* the journal means migrations are pending, which is a
  legitimate state — it is what production looks like before a release. Verify
  it matches the commit that was actually deployed, not the tip of the branch.

- **Tables.** The `public` schema should hold one base table per `pgTable`
  declared across `db/schema.ts` and `db/erp-schema.ts`:

  ```bash
  grep -rh "pgTable(" db/schema.ts db/erp-schema.ts | wc -l
  ```
  ```sql
  select count(*) from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';
  ```

  Expect the database to be short by exactly the tables that pending migrations
  would add, and by nothing else. Any other shortfall means the restore lost a
  table.

- Enum types, check constraints and foreign keys are present.

**Current verified reading, 2026-08-31** (read-only, production, PostgreSQL
17.6): the migration ledger holds **20 rows** against 20 journal entries, and
the `public` schema holds **61 base tables** against 61 declared across
`db/schema.ts` (31) and `db/erp-schema.ts` (30). `0017`, `0018` and `0019` are
**APPLIED** — nothing is pending. The tables they added are present:
`cashier_shift_cash_counts` (`0018`), and `category_translations` and
`product_translations` (`0019`); `0017` added a nullable column, not a table.
Content readings taken at the same time: `category_translations` **656 rows**,
`product_translations` **5252 rows**.

> **Historical (superseded):** an earlier reading on the same day, taken before
> the release migrations were applied, recorded ledger 17 / 58 base tables with
> `0017`–`0019` pending. That snapshot no longer describes production and must
> not be used as an expectation.

### 6. Row-count sanity checks

Compare row counts against the last known-good numbers for at least: `orders`,
`order_items`, `payments`, `payment_refunds`, `order_checks`,
`order_check_items`, `audit_logs`, `order_events`, `products`,
`staff_profiles`. A restore that silently lost a table is worse than no
restore.

### 7. Auth and RLS validation

- `staff_profiles.auth_user_id` still resolves to rows in `auth.users`.
- RLS is enabled on every domain table.
- An anonymous client can read nothing it should not; a staff client sees only
  its own restaurant. The Phase 7D suites
  (`tests/integration/phase7d-auth-rls.integration.test.ts`,
  `phase7d-tenant-isolation.integration.test.ts`) encode these expectations and
  can be pointed at the restored database.

### 8. Financial ledger checks

Per restaurant, on the restored data:

- every `payments` row references an existing `orders` row in the same tenant;
- `payments.refunded_amount` equals the sum of that payment's
  `payment_refunds` rows;
- `refunded_amount <= amount` for every payment (also enforced by a check
  constraint — a violation means the restore is corrupt);
- `orders.total = subtotal − discount_total + service_charge_total + tax_total`;
- no order is marked `COMPLETED` while its collected total is below its total.

Cash accountability, which is a separate record from the order ledger:

- every `CLOSED` shift carries `closed_at`, `closed_by_staff_id`,
  `counted_cash_at_close`, `expected_cash_at_close` and `cash_variance`, and
  every `OPEN` one carries none of them (the closure-consistency check
  constraint — a violation means the restore is corrupt);
- `cash_variance = counted_cash_at_close − expected_cash_at_close` on every
  closed shift;
- at most one `OPEN` shift per register and per staff member;
- every `cash_drawer_movements` row references a shift in the same tenant, and
  every amount is positive;
- payments and refunds carrying a `cashier_shift_id` point at a shift in their
  own restaurant. A `NULL` there is legitimate: it means the row predates
  shifts, and it is never back-filled.

Operational Z reports, which are the stored record of each closed drawer:

- the three snapshot columns move together — `z_report_snapshot`,
  `z_report_version` and `z_report_generated_at` are either all present on a
  `CLOSED` shift or all absent (the consistency check constraint);
- every snapshot parses under `parseZSnapshot`, and its `version` is one the
  running code supports;
- inside each snapshot the arithmetic still holds:
  `sum(paymentMethodBreakdown) = grossCollected`,
  `sum(refundMethodBreakdown) = totalRefunds`,
  `netCollected = grossCollected − totalRefunds`, and
  `cashVariance = countedCash − expectedCash`;
- a snapshot's figures match the shift row it sits on
  (`expectedCash`/`countedCash`/`cashVariance` against
  `expected_cash_at_close`/`counted_cash_at_close`/`cash_variance`).

A shift closed before Phase 8B legitimately has no snapshot. That is LEGACY,
not corruption, and no report is reconstructed for it.

### 9. Application smoke test

Point a non-production deployment at the restored database and drive one full
path: scan a QR → view menu → create an order → kitchen transition → collect
payment → close the table. Confirm reports render for a historical period.

### 10. Cutover decision

Only now decide whether to promote the restored database. Plan for: connection
strings, environment variables, DNS/deployment target, the outbox scheduler,
and the maintenance scheduler. Expect to re-point `DATABASE_URL` and to restart
the deployment. Record the moment of cutover.

### 11. Post-restore audit

- Reconcile any writes accepted after the restore point (step 2).
- Verify the outbox: pending events from before the incident may re-publish;
  confirm no dead-lettered events were lost.
- Rotate any credential that may have been exposed during the incident.
- Write an incident record: cause, restore point, data actually lost, and what
  would have prevented it.

## Recovery drill without a managed restore

Until a real managed restore has been rehearsed, run a **logical verification
drill** on a disposable copy. It exercises steps 5–9 without needing a real
backup:

1. Apply all migrations to an empty disposable database.
2. Seed a known fixture.
3. Run `npx drizzle-kit check` and the migration-count check.
4. Confirm all 61 base tables exist (see the derived counts in step 5).
5. Run `npm run test:integration` against it (Auth/RLS, tenant isolation,
   financial concurrency and the Phase 7F retention suite all execute there).
6. Call `GET /api/internal/maintenance` and confirm the health report renders
   sizes, migration count and queue depth.

A drill is not a substitute for rehearsing the real restore path, and this
document does not claim otherwise.

## Prohibited

- Never test a restore against the production database.
- Never run a destructive restore against the TEST database without an explicit
  request.
- Never `TRUNCATE`, `DROP SCHEMA`, or delete all tenant data / all auth users
  as part of a recovery procedure.
- Never move financial history to CSV and delete it from the database: the
  database remains the reporting source of truth.

## After a restore: the print queue

A restore rewinds the queue with everything else, and paper does not rewind.
Before bringing agents back online, expect both failure directions:

- Jobs that were `PRINTED` after the restore point return as `PENDING` and will
  print **again**. Tickets already on the pass will be duplicated.
- Jobs enqueued after the restore point are gone. Nothing reprints them
  automatically; the affected orders are still intact and can be reprinted from
  the admin queue, with a reason, once the situation is understood.

The safe sequence is therefore: restore, **keep the agents stopped**, review
`print_jobs` for the affected window, cancel what must not be reprinted, and
only then start the agents. The agent's local journal survives the restore
(it is on the restaurant's machine, not in the database) and will suppress
re-completion of job ids it already finished, which reduces but does not
eliminate duplicate paper.

No print job is ever a financial record. Losing or duplicating one changes no
order, no payment and no shift figure — only what came out of the printer.
