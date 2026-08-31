import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The release has to compile on its own.
 *
 * Four errors reached a clean release worktree that a built, half-finished
 * working copy hid completely: a type that only exists after `next build`, a
 * shipped feature importing an unfinished one, and two token codecs left
 * incomplete. Each is cheap to state and each cost a release, so each is stated
 * here.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the root layout names its own props instead of a generated global", () => {
  const layout = read("app/layout.tsx");
  // `LayoutProps` / `PageProps` are written into `.next/types` by the build, so
  // a checkout that has never been built cannot typecheck against them. The
  // comments in that file explain exactly this, so only the code is read.
  const code = layout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.doesNotMatch(code, /\bLayoutProps\s*</);
  assert.doesNotMatch(code, /\bPageProps\s*</);
  assert.match(layout, /children\s*}:\s*\{\s*readonly children:\s*ReactNode\s*}/);

  // The other layouts already did this; they must keep doing it.
  for (const path of ["app/admin/layout.tsx", "app/staff/layout.tsx"]) {
    assert.match(read(path), /children\s*}:\s*\{\s*children:\s*ReactNode\s*}/, path);
  }
});

test("the release does not need a font network request to compile", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/globals.css");

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(css, /--font-manrope:/);
  assert.match(css, /--font-lora:/);
});

test("the table and QR screens do not import the menu editor", () => {
  // `use-menu-draft` belongs to the WYSIWYG menu editor. A shipped table/QR
  // screen reaching into it makes the release depend on unfinished work.
  for (const path of [
    "components/admin/table-detail-sheet.tsx",
    "components/admin/qr-manager.tsx",
    "components/admin/qr-access-toggle.tsx",
    "components/admin/tables-manager.tsx",
  ]) {
    assert.doesNotMatch(
      read(path),
      /@\/components\/admin\/(use-menu-draft|customer-menu-editor|menu-editor-dialogs|menu-manager)/,
      `${path} depends on the menu editor`,
    );
  }
  // The panel shape comes from one shared, client-safe hook.
  assert.match(
    read("components/admin/table-detail-sheet.tsx"),
    /import \{ useIsDesktop } from "@\/components\/shared\/use-is-desktop";/,
  );
  const hook = read("components/shared/use-is-desktop.ts");
  assert.match(hook, /^"use client";/);
  assert.match(hook, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
  // A server snapshot and a real unsubscribe: no hydration crash, no leak.
  assert.match(hook, /function getServerSnapshot\(\): boolean/);
  assert.match(hook, /removeEventListener\("change", onChange\)/);
});

test("every table token codec is complete and none of them fakes verification", () => {
  const required = ["generate", "hash", "verify", "deriveLink", "verifyLink"];

  // The customer QR gate and the admin service build the same complete codec.
  const gate = read("lib/auth/menu-gate.server.ts");
  assert.match(gate, /createTableService\(\)/, "the menu gate builds its own partial codec");

  const factory = read("lib/services/table-service.server.ts");
  for (const member of required) {
    assert.match(factory, new RegExp(`${member}:`), `the service factory omits ${member}`);
  }

  const integration = read("tests/integration/phase3-backend-flow.integration.test.ts");
  for (const member of required) {
    assert.match(integration, new RegExp(`${member}:`), `the integration codec omits ${member}`);
  }
  // Real signing with the fixture's own pepper, never a constant.
  assert.match(integration, /deriveLink: \(claims\) => deriveQrLinkToken\(claims, fixture\.pepper\)/);
  assert.match(integration, /verifyQrLinkToken\(candidate, claims, fixture\.pepper\)/);
  for (const source of [factory, integration, gate]) {
    assert.doesNotMatch(source, /verifyLink:\s*\(\)\s*=>\s*(true|false)/, "verification is stubbed");
    assert.doesNotMatch(source, /verify:\s*\(\)\s*=>\s*true/, "verification is stubbed");
  }
});

test("the customer gate still accepts both QR credentials", () => {
  // The gate delegates to the service, which keeps the legacy random token and
  // the derived `l1` link on separate branches.
  const service = read("lib/services/table-service.ts");
  assert.match(service, /parseQrLinkToken\(rawToken\)/);
  assert.match(service, /findSessionByTableRef\(/);
  assert.match(service, /findSessionByTokenHash\(tokenHash\)/);

  // And the shape check at the edge admits both.
  const validation = read("lib/validation/common.ts");
  assert.match(validation, /\[A-Za-z0-9_-\]\{43\}/);
  assert.match(validation, /\^l1\\\./);
});
