# Integration tests (Phase 3 and Phase 4)

These tests write temporary, uniquely identified rows. Run them only against a
local Supabase stack or a disposable test project that already has all Drizzle
migrations applied. They never fall back to the application's normal Supabase
or database variables.

Required variables:

```text
RUN_SUPABASE_INTEGRATION_TESTS=true
SUPABASE_INTEGRATION_TEST_CONFIRM=I_UNDERSTAND_TEMPORARY_DATA_WILL_BE_CREATED
SUPABASE_INTEGRATION_TEST_URL=
SUPABASE_INTEGRATION_TEST_ANON_KEY=
SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY=
```

For a remote project, also set the exact project reference from
`https://<project-ref>.supabase.co`:

```text
SUPABASE_INTEGRATION_TEST_PROJECT_REF=
```

The backend transaction flow additionally requires the direct/pooler test
database URL:

```text
SUPABASE_INTEGRATION_TEST_DATABASE_URL=
```

For remote projects the database hostname or pooler username must contain the
same project reference. For local Supabase both API and database hosts must be
loopback addresses. This deliberately rejects ambiguous cross-project URLs.

Because production repositories carry the `server-only` marker, invoke the
suite with Node's React Server condition:

```powershell
node --conditions=react-server --import tsx --test tests/integration/*.test.ts
```

With no opt-in or credentials, the files emit one explicit skipped test each
and perform no network or database work. Production/ Vercel production
environments are rejected even when the opt-in variables are present.

## Real HTTP/Auth/cookie E2E

`phase3-http-e2e.integration.test.ts` targets an already-running dedicated test
deployment and its pre-provisioned fixture. It does not use normal application
variables, create staff accounts, or provision a remote project. The fixture
must contain one active table QR, one available product, and active Supabase
Auth-backed `WAITER`, `KITCHEN`, and `CASHIER` profiles in the same restaurant.
It must also contain one active staff profile belonging to a different test
restaurant so the HTTP boundary can prove cross-tenant order isolation.

```text
RUN_SEHIR_HTTP_E2E_TESTS=true
SEHIR_HTTP_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE
SEHIR_HTTP_E2E_TARGET_CLASS=DISPOSABLE_TEST
SEHIR_HTTP_E2E_BASE_URL=https://dedicated-test-deployment.example
SEHIR_HTTP_E2E_ALLOWED_ORIGIN=https://dedicated-test-deployment.example
SEHIR_HTTP_E2E_QR_TOKEN=
SEHIR_HTTP_E2E_PRODUCT_ID=
SEHIR_HTTP_E2E_WAITER_IDENTIFIER=
SEHIR_HTTP_E2E_WAITER_PASSWORD=
SEHIR_HTTP_E2E_KITCHEN_IDENTIFIER=
SEHIR_HTTP_E2E_KITCHEN_PASSWORD=
SEHIR_HTTP_E2E_CASHIER_IDENTIFIER=
SEHIR_HTTP_E2E_CASHIER_PASSWORD=
SEHIR_HTTP_E2E_OTHER_TENANT_IDENTIFIER=
SEHIR_HTTP_E2E_OTHER_TENANT_PASSWORD=
```

`phase4-admin-e2e.integration.test.ts` reuses the same fixture and adds the
admin CRUD, availability and payment flows. It stays skipped until an `ADMIN`
credential is also supplied:

```text
SEHIR_HTTP_E2E_ADMIN_IDENTIFIER=
SEHIR_HTTP_E2E_ADMIN_PASSWORD=
```

That suite changes the fixture product price and availability and restores both
in a `finally` block, then drives one order through to a completed payment. It
never deletes rows, so payments and audit history accumulate on the fixture.

The origin must be repeated exactly, remote targets must use HTTPS, and the
suite refuses `NODE_ENV=production`, `VERCEL_ENV=production`, and the current
`VERCEL_PROJECT_PRODUCTION_URL`. Never point these variables at the live
restaurant deployment.

The suite deliberately completes the order it creates, but call/bill rows and
audit/outbox history remain. Use a disposable database or reset only the
dedicated fixture between runs. Also clear its test rate-limit rows (or wait for
the 30-second waiter-call and 2-minute bill-request windows). Never automate a
broad production cleanup. Raw QR tokens, passwords, Auth cookies, and table
session cookies are kept in memory and are not included in assertion output.
