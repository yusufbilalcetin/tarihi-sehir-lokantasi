# Database backup and recovery runbook

This is the recovery contract for the central PostgreSQL/Supabase database. It
covers what must exist before production, and what to do when something has
gone wrong.

## Honest status of managed backups

**MANAGED BACKUP CAPABILITY REQUIRES DASHBOARD/PLAN VERIFICATION.**

Nothing in this repository can prove which backup features are enabled on a
Supabase project. Backup schedules, retention windows and point-in-time
recovery are plan-dependent project settings, not code. They were therefore
**not** verified during Phase 7F, and no claim about them is made here.

The following statements are **not** made by this document and must not be
copied into any other document until someone has confirmed them in the Supabase
dashboard for the specific project:

- "daily backups are enabled"
- "PITR is enabled"
- "backups are retained for N days"
- "RPO is N minutes"

**MANAGED BACKUP CONFIGURATION REQUIRES PRODUCTION PLAN DECISION.**

### Verification checklist (do this before production)

1. Open the production Supabase project → Database → Backups.
2. Record: whether scheduled backups exist, their frequency, their retention
   window, and whether point-in-time recovery is available on the current plan.
3. Record whether the plan needs upgrading to reach the required recovery
   objective.
4. Write the confirmed answers into this section, dated, with the project ref.
5. Take one manual backup/export before the first production cutover.

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
| Database rows | Supabase managed PostgreSQL | Managed backup / PITR — see verification above |
| Schema | `db/migrations/0000…` in this repository | Re-apply migrations in order with `npm run db:migrate` |
| Source code | Git repository | Clone at the tagged/deployed commit |
| Product images | Supabase Storage bucket (`SUPABASE_STORAGE_BUCKET`, default `product-images`) | Storage backup is **separate** from database backup and must be confirmed separately |
| Secrets and configuration | Deployment secret manager | See below |
| Auth users | Supabase Auth (`auth.users`) | Part of the managed project, not of `public` — confirm it is included in whatever restore path is chosen |
| Printer agent configuration | The restaurant's own machine (`printer-agent.config.json`) | Not in this repository and not in any backup here; the device map is re-entered on site — see `docs/printing.md` |

The database stores only the *path/reference* to a product image. Restoring the
database without the Storage bucket produces a catalogue of broken images; both
must be restored to the same point.

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

Choose the latest backup or PITR target **before** the earliest known-bad
timestamp. Record the exact target timestamp and the expected data loss window
(target → now). Compare it against the agreed RPO.

### 4. Restore into an isolated environment first

Restore to a **new** project or database, never over the live one. This makes
every check below non-destructive and preserves the option to abandon the
restore.

### 5. Verify schema

```bash
npx drizzle-kit check                 # migration ledger is internally consistent
```

On the restored database, confirm:

- the `drizzle.__drizzle_migrations` ledger has the expected number of rows
  (10 as of migration `0009`);
- all 20 `public` tables exist;
- enum types, check constraints and foreign keys are present.

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
4. Confirm all 28 tables exist.
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
