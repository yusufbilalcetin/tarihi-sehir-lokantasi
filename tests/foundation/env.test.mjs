import assert from "node:assert/strict";
import test from "node:test";

import { loadTypeScriptModule } from "./load-typescript.mjs";

const moduleCache = new Map();
const {
  parseOptionalPublicEnvironment,
  parseServerEnvironment,
  validatePublicEnvironment,
} = loadTypeScriptModule("lib/env/validation.ts", moduleCache);
const { EnvironmentConfigurationError } = loadTypeScriptModule(
  "lib/env/errors.ts",
  moduleCache,
);

const publicKey = `sb_publishable_${"a".repeat(32)}`;

test("optional public environment is lazy when Supabase is absent", () => {
  assert.equal(parseOptionalPublicEnvironment({}), null);
});

test("public environment accepts HTTPS and strips one trailing slash", () => {
  assert.deepEqual(
    parseOptionalPublicEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    }),
    {
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: publicKey,
    },
  );
});

test("partial public configuration fails without exposing values", () => {
  const secretLikeValue = "should-never-appear-in-error";
  const result = validatePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secretLikeValue,
  });
  assert.equal(result.success, false);
  assert.throws(
    () =>
      parseOptionalPublicEnvironment({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secretLikeValue,
      }),
    (error) =>
      error instanceof EnvironmentConfigurationError &&
      !error.message.includes(secretLikeValue) &&
      error.message.includes("NEXT_PUBLIC_SUPABASE_URL"),
  );
});

test("remote plaintext Supabase URL is rejected but localhost is allowed", () => {
  assert.equal(
    validatePublicEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "http://example.com",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    }).success,
    false,
  );
  assert.equal(
    validatePublicEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    }).success,
    true,
  );
});

test("server requirements are capability-scoped", () => {
  assert.equal(parseServerEnvironment({}).supabaseStorageBucket, "product-images");
  assert.throws(
    () => parseServerEnvironment({}, ["database", "qr-token", "customer-session"]),
    (error) =>
      error instanceof EnvironmentConfigurationError &&
      error.issues.some((item) => item.name === "DATABASE_URL") &&
      error.issues.some((item) => item.name === "QR_TOKEN_PEPPER") &&
      error.issues.some((item) => item.name === "AUTH_SECRET"),
  );
  assert.equal(
    parseServerEnvironment(
      {
        DATABASE_URL: "postgresql://app:password@localhost:5432/app",
        QR_TOKEN_PEPPER: "p".repeat(48),
        AUTH_SECRET: "s".repeat(48),
        LOG_LEVEL: "warn",
      },
      ["database", "qr-token", "customer-session"],
    ).logLevel,
    "warn",
  );
});

test("storage bucket is optional, normalized only by explicit input, and invalid names fail", () => {
  assert.equal(
    parseServerEnvironment({ SUPABASE_STORAGE_BUCKET: "menu_assets" })
      .supabaseStorageBucket,
    "menu_assets",
  );
  assert.throws(
    () => parseServerEnvironment({ SUPABASE_STORAGE_BUCKET: "../Private Bucket" }),
    (error) =>
      error instanceof EnvironmentConfigurationError &&
      error.issues.some((item) => item.name === "SUPABASE_STORAGE_BUCKET"),
  );
});
