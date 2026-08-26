import assert from "node:assert/strict";
import test from "node:test";

import { readSupabaseIntegrationEnvironment } from "../integration/supabase-test-environment";

/**
 * The integration suite writes orders, payments and audit history, and never
 * deletes them. Every other check in the readiness helper only proves the test
 * variables agree with each other — which copying the live values satisfies
 * perfectly. These cases pin the one check that compares the test target with
 * the application's own target.
 */

const BASE = {
  RUN_SUPABASE_INTEGRATION_TESTS: "true",
  SUPABASE_INTEGRATION_TEST_CONFIRM: "I_UNDERSTAND_TEMPORARY_DATA_WILL_BE_CREATED",
  SUPABASE_INTEGRATION_TEST_ANON_KEY: "anon-key",
  SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY: "service-key",
} as const;

const POOLER = "aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

/** A complete, legitimately separate remote target; cases override one field. */
const SEPARATE_REMOTE = {
  SUPABASE_INTEGRATION_TEST_URL: "https://testproj.supabase.co",
  SUPABASE_INTEGRATION_TEST_PROJECT_REF: "testproj",
  SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.testproj:pw@${POOLER}`,
  NEXT_PUBLIC_SUPABASE_URL: "https://liveproj.supabase.co",
  DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
} as const;

function readWith(overrides: Record<string, string | undefined>) {
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("SUPABASE_INTEGRATION_TEST") ||
        key === "RUN_SUPABASE_INTEGRATION_TESTS"
      ) {
        delete process.env[key];
      }
    }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL_ENV;
    Object.assign(process.env, BASE, overrides);
    // `Object.assign` writes `undefined` as the string "undefined", which would
    // read as a value that is present; an absent variable has to be removed.
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
    }
    return readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
  } finally {
    // Restoring the whole object also undoes every NODE_ENV/VERCEL_ENV change.
    process.env = saved;
  }
}

/** Readiness must never be granted on an incomplete or ambiguous target. */
function assertRefused(
  result: ReturnType<typeof readWith>,
  expected: RegExp,
  label: string,
) {
  assert.equal(result.ready, false, `${label} must be refused`);
  assert.match(result.ready ? "" : result.reason, expected, label);
}

test("a disposable remote test project is accepted", () => {
  const result = readWith({
    SUPABASE_INTEGRATION_TEST_URL: "https://testproj.supabase.co",
    SUPABASE_INTEGRATION_TEST_PROJECT_REF: "testproj",
    SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.testproj:pw@${POOLER}`,
    NEXT_PUBLIC_SUPABASE_URL: "https://liveproj.supabase.co",
    DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
  });
  assert.equal(result.ready, true);
});

test("a test URL aimed at the application's own Supabase project is refused", () => {
  const result = readWith({
    SUPABASE_INTEGRATION_TEST_URL: "https://liveproj.supabase.co",
    SUPABASE_INTEGRATION_TEST_PROJECT_REF: "liveproj",
    SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
    NEXT_PUBLIC_SUPABASE_URL: "https://liveproj.supabase.co",
    DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
  });
  assert.equal(result.ready, false);
  assert.match(result.ready ? "" : result.reason, /same Supabase project/);
});

test("a shared database identity is refused even when the API hosts differ", () => {
  const result = readWith({
    SUPABASE_INTEGRATION_TEST_URL: "https://testproj.supabase.co",
    SUPABASE_INTEGRATION_TEST_PROJECT_REF: "testproj",
    SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.testproj:pw@${POOLER}`,
    NEXT_PUBLIC_SUPABASE_URL: "https://liveproj.supabase.co",
    DATABASE_URL: `postgresql://postgres.testproj:pw@${POOLER}`,
  });
  assert.equal(result.ready, false);
  assert.match(result.ready ? "" : result.reason, /same database identity/);
});

test("one local Supabase stack may serve both the app and the suite", () => {
  const result = readWith({
    SUPABASE_INTEGRATION_TEST_URL: "http://127.0.0.1:54321",
    SUPABASE_INTEGRATION_TEST_DATABASE_URL: "postgresql://postgres:pw@127.0.0.1:54322/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    DATABASE_URL: "postgresql://postgres:pw@127.0.0.1:54322/postgres",
  });
  assert.equal(result.ready, true);
});

test("the opt-in flag alone gates the whole suite", () => {
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, RUN_SUPABASE_INTEGRATION_TESTS: undefined }),
    /opt-in/i,
    "missing RUN flag",
  );
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, RUN_SUPABASE_INTEGRATION_TESTS: "yes" }),
    /opt-in/i,
    "non-exact RUN flag",
  );
});

test("a missing or altered confirmation token is refused", () => {
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, SUPABASE_INTEGRATION_TEST_CONFIRM: undefined }),
    /SUPABASE_INTEGRATION_TEST_CONFIRM/,
    "missing confirmation",
  );
  assertRefused(
    readWith({
      ...SEPARATE_REMOTE,
      SUPABASE_INTEGRATION_TEST_CONFIRM: "i_understand_temporary_data_will_be_created",
    }),
    /SUPABASE_INTEGRATION_TEST_CONFIRM/,
    "wrong-case confirmation",
  );
});

test("incomplete credentials never resolve to a ready target", () => {
  for (const key of [
    "SUPABASE_INTEGRATION_TEST_URL",
    "SUPABASE_INTEGRATION_TEST_ANON_KEY",
    "SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY",
    "SUPABASE_INTEGRATION_TEST_DATABASE_URL",
  ]) {
    assertRefused(
      readWith({ ...SEPARATE_REMOTE, [key]: undefined }),
      /Missing dedicated integration-test configuration/,
      `missing ${key}`,
    );
  }
});

test("a remote target must repeat its project ref exactly", () => {
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, SUPABASE_INTEGRATION_TEST_PROJECT_REF: undefined }),
    /PROJECT_REF/,
    "missing project ref",
  );
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, SUPABASE_INTEGRATION_TEST_PROJECT_REF: "otherproj" }),
    /PROJECT_REF/,
    "mismatched project ref",
  );
});

test("production markers disable the suite even with a separate target", () => {
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, NODE_ENV: "production" }),
    /production/i,
    "NODE_ENV=production",
  );
  assertRefused(
    readWith({ ...SEPARATE_REMOTE, VERCEL_ENV: "production" }),
    /production/i,
    "VERCEL_ENV=production",
  );
});

test("the same project is caught however the application URL is written", () => {
  // Trailing slash, uppercase host and an explicit port all normalise to the
  // same origin, so none of them may be used to slip past the comparison.
  for (const applicationUrl of [
    "https://liveproj.supabase.co/",
    "https://LIVEPROJ.supabase.co",
    "https://liveproj.supabase.co:443",
  ]) {
    assertRefused(
      readWith({
        ...SEPARATE_REMOTE,
        SUPABASE_INTEGRATION_TEST_URL: "https://liveproj.supabase.co",
        SUPABASE_INTEGRATION_TEST_PROJECT_REF: "liveproj",
        SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
        NEXT_PUBLIC_SUPABASE_URL: applicationUrl,
      }),
      /same Supabase project/,
      `application URL written as ${applicationUrl}`,
    );
  }
});

test("a shared database identity is caught regardless of letter case", () => {
  assertRefused(
    readWith({
      ...SEPARATE_REMOTE,
      DATABASE_URL: `postgresql://postgres.testproj:pw@${POOLER.toUpperCase()}`,
    }),
    /same database identity/,
    "uppercase application database host",
  );
});

test("an ambiguous remote host that is not a Supabase project is refused", () => {
  assertRefused(
    readWith({
      ...SEPARATE_REMOTE,
      SUPABASE_INTEGRATION_TEST_URL: "https://staging.example.com",
    }),
    /explicit <project-ref>\.supabase\.co test project/,
    "non-Supabase remote host",
  );
});

test("a remote API target may not be paired with a loopback database", () => {
  assertRefused(
    readWith({
      ...SEPARATE_REMOTE,
      SUPABASE_INTEGRATION_TEST_DATABASE_URL: "postgresql://postgres:pw@127.0.0.1:54322/postgres",
    }),
    /does not match SUPABASE_INTEGRATION_TEST_PROJECT_REF/,
    "remote API with loopback database",
  );
});

test("a disposable-target declaration is exact, and powerless on its own", () => {
  const shared = {
    ...SEPARATE_REMOTE,
    SUPABASE_INTEGRATION_TEST_URL: "https://liveproj.supabase.co",
    SUPABASE_INTEGRATION_TEST_PROJECT_REF: "liveproj",
    SUPABASE_INTEGRATION_TEST_DATABASE_URL: `postgresql://postgres.liveproj:pw@${POOLER}`,
  };

  // Without the declaration the shared target stays refused.
  assertRefused(readWith(shared), /same Supabase project/, "no declaration");

  // Near misses do not count as a declaration.
  for (const value of ["disposable_test", "DISPOSABLE", "true", "yes", ""]) {
    assertRefused(
      readWith({ ...shared, SUPABASE_INTEGRATION_TEST_TARGET_CLASS: value }),
      /same Supabase project/,
      `declaration value ${JSON.stringify(value)}`,
    );
  }

  // The exact declaration accepts the shared target...
  assert.equal(
    readWith({ ...shared, SUPABASE_INTEGRATION_TEST_TARGET_CLASS: "DISPOSABLE_TEST" }).ready,
    true,
  );

  // ...but it overrides nothing else: production and the other opt-ins still win.
  assertRefused(
    readWith({
      ...shared,
      SUPABASE_INTEGRATION_TEST_TARGET_CLASS: "DISPOSABLE_TEST",
      NODE_ENV: "production",
    }),
    /production/i,
    "declaration with NODE_ENV=production",
  );
  assertRefused(
    readWith({
      ...shared,
      SUPABASE_INTEGRATION_TEST_TARGET_CLASS: "DISPOSABLE_TEST",
      VERCEL_ENV: "production",
    }),
    /production/i,
    "declaration with VERCEL_ENV=production",
  );
  assertRefused(
    readWith({
      ...shared,
      SUPABASE_INTEGRATION_TEST_TARGET_CLASS: "DISPOSABLE_TEST",
      RUN_SUPABASE_INTEGRATION_TESTS: undefined,
    }),
    /opt-in/i,
    "declaration without the run flag",
  );
  assertRefused(
    readWith({
      ...shared,
      SUPABASE_INTEGRATION_TEST_TARGET_CLASS: "DISPOSABLE_TEST",
      SUPABASE_INTEGRATION_TEST_CONFIRM: undefined,
    }),
    /SUPABASE_INTEGRATION_TEST_CONFIRM/,
    "declaration without the confirmation token",
  );
});

test("the anonymous and service-role keys must differ", () => {
  assertRefused(
    readWith({
      ...SEPARATE_REMOTE,
      SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY: "anon-key",
    }),
    /must be different/,
    "reused key",
  );
});
