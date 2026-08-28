import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { resolveTestAccount } from "../../lib/auth/simple-test-login";
import type {
  ChangeTableTokenRecordInput,
  ManagedTableRecord,
  TableRepository,
  TableSessionRecord,
} from "../../lib/repositories/table-repository";
import { deriveQrLinkToken, verifyQrLinkToken } from "../../lib/security/qr-link-token";
import { TableService, type TableTokenCodec } from "../../lib/services/table-service";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const pepper = "p".repeat(48);
const admin: RestaurantPrincipal = {
  userId: "user-1",
  restaurantId: "restaurant-1",
  role: "ADMIN",
  isActive: true,
};

/* ------------------------------------------------------- QR pause/resume -- */

/**
 * Pausing is an access flag, not credential revocation: the printed code has
 * to work again afterwards, so the version and the hash must survive it.
 */
class AccessFakeRepository implements TableRepository {
  writes = 0;
  audits: string[] = [];
  session: TableSessionRecord = {
    id: "table-1",
    restaurantId: "restaurant-1",
    name: "Masa 2",
    tableNumber: 2,
    seats: 2,
    qrTokenHash: "v1.original",
    qrTokenVersion: 8,
    qrTokenRevokedAt: new Date("2026-08-27T10:00:00.000Z"),
    tableIsActive: true,
    restaurantName: "Tarihi Sehir Lokantasi",
    restaurantSlug: "tarihi-sehir-lokantasi",
    restaurantIsActive: true,
    currency: "TRY",
    timezone: "Europe/Istanbul",
  };

  private managed(): ManagedTableRecord {
    return {
      id: this.session.id,
      restaurantId: this.session.restaurantId,
      name: this.session.name,
      tableNumber: this.session.tableNumber,
      seats: this.session.seats,
      qrTokenVersion: this.session.qrTokenVersion,
      qrTokenRevokedAt: this.session.qrTokenRevokedAt,
      isActive: this.session.tableIsActive,
    };
  }

  private change(input: ChangeTableTokenRecordInput, paused: boolean): ManagedTableRecord | null {
    // Tenant scope is a predicate on the row, exactly as the SQL is.
    if (input.restaurantId !== this.session.restaurantId) return null;
    if (input.tableId !== this.session.id) return null;
    const isPaused = this.session.qrTokenRevokedAt !== null;
    if (isPaused === paused) return this.managed();
    this.writes += 1;
    this.audits.push(paused ? "TABLE_QR_PAUSED" : "TABLE_QR_RESUMED");
    this.session = {
      ...this.session,
      qrTokenRevokedAt: paused ? new Date("2026-08-28T10:00:00.000Z") : null,
    };
    return this.managed();
  }

  async pauseQrAccessWithAudit(input: ChangeTableTokenRecordInput) {
    return this.change(input, true);
  }
  async resumeQrAccessWithAudit(input: ChangeTableTokenRecordInput) {
    return this.change(input, false);
  }
  async findSessionByTokenHash(hash: string) {
    return this.session.qrTokenHash === hash ? this.session : null;
  }
  async findSessionByTableRef(slug: string, tableNumber: number) {
    return this.session.restaurantSlug === slug && this.session.tableNumber === tableNumber
      ? this.session
      : null;
  }
  async listSessionsForRestaurant(restaurantId: string) {
    return this.session.restaurantId === restaurantId ? [this.session] : [];
  }
  async createWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
  async rotateTokenWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
  async revokeTokenWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
  async updateWithAudit(): Promise<ManagedTableRecord | null> {
    throw new Error("not used");
  }
}

function codec(): TableTokenCodec {
  return {
    generate: () => ({ rawToken: "r".repeat(43), tokenHash: "v1.rotated" }),
    hash: (rawToken) => `v1.${rawToken}`,
    verify: () => false,
    deriveLink: (claims) => deriveQrLinkToken(claims, pepper),
    verifyLink: (candidate, claims) => verifyQrLinkToken(candidate, claims, pepper),
  };
}

function build() {
  const repository = new AccessFakeRepository();
  return { repository, service: new TableService(repository, codec()) };
}

test("resuming a paused table clears the flag and touches nothing else", async () => {
  const { repository, service } = build();
  const versionBefore = repository.session.qrTokenVersion;
  const hashBefore = repository.session.qrTokenHash;
  const urlBefore = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;

  const result = await service.resumeQrAccess(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });

  assert.equal(result.tokenRevokedAt, null, "the table is still paused");
  assert.equal(result.accessVersion, versionBefore, "resume moved the access version");
  assert.equal(repository.session.qrTokenHash, hashBefore, "resume rewrote the credential");
  assert.deepEqual(repository.audits, ["TABLE_QR_RESUMED"]);

  // The printed card has to keep working: same deterministic address.
  const urlAfter = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  assert.equal(urlAfter, urlBefore, "the QR address changed across a resume");
});

test("the legacy paused row keeps its version through a resume", async () => {
  const { repository, service } = build();
  assert.equal(repository.session.qrTokenVersion, 8);
  const result = await service.resumeQrAccess(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  assert.equal(result.accessVersion, 8, "a resume must never renumber the credential");
});

test("pause and resume can be repeated without drift", async () => {
  const { repository, service } = build();
  const input = { restaurantId: "restaurant-1", tableId: "table-1" };
  const url = async () => (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  const before = await url();

  await service.resumeQrAccess(admin, input);
  await service.pauseQrAccess(admin, input);
  const resumed = await service.resumeQrAccess(admin, input);
  await service.pauseQrAccess(admin, input);
  const finalState = await service.resumeQrAccess(admin, input);

  assert.equal(resumed.tokenRevokedAt, null);
  assert.equal(finalState.tokenRevokedAt, null);
  assert.equal(finalState.accessVersion, 8);
  assert.equal(await url(), before);
  assert.deepEqual(repository.audits, [
    "TABLE_QR_RESUMED",
    "TABLE_QR_PAUSED",
    "TABLE_QR_RESUMED",
    "TABLE_QR_PAUSED",
    "TABLE_QR_RESUMED",
  ]);
});

test("resuming a table that is already active writes nothing", async () => {
  const { repository, service } = build();
  await service.resumeQrAccess(admin, { restaurantId: "restaurant-1", tableId: "table-1" });
  const writes = repository.writes;

  const again = await service.resumeQrAccess(admin, {
    restaurantId: "restaurant-1",
    tableId: "table-1",
  });
  assert.equal(again.tokenRevokedAt, null);
  assert.equal(repository.writes, writes, "an idempotent resume manufactured a write");
});

test("a paused table is refused to guests and served again after resume", async () => {
  const { repository, service } = build();
  const path = (await service.listQrLinks(admin, "restaurant-1")).links[0].menuPath;
  const token = path.slice("/menu/".length);

  await assert.rejects(() => service.validateToken(token), "a paused QR still opened the menu");
  await service.resumeQrAccess(admin, { restaurantId: "restaurant-1", tableId: "table-1" });
  const session = await service.validateToken(token);
  assert.equal(session.table.name, "Masa 2");
  assert.equal(session.table.accessVersion, 8);
  assert.equal(repository.session.qrTokenVersion, 8);
});

test("another restaurant cannot resume this table", async () => {
  const { service } = build();
  await assert.rejects(() =>
    service.resumeQrAccess(
      { ...admin, restaurantId: "restaurant-2" },
      { restaurantId: "restaurant-2", tableId: "table-1" },
    ),
  );
  // A waiter is authenticated but not a table manager.
  await assert.rejects(() =>
    service.resumeQrAccess(
      { ...admin, role: "WAITER" },
      { restaurantId: "restaurant-1", tableId: "table-1" },
    ),
  );
});

test("the toggle's client contract is the route that exists", () => {
  const endpoints = read("lib/api/endpoints.ts");
  const toggle = read("components/admin/qr-access-toggle.tsx");

  // Method and path, on both sides.
  assert.match(endpoints, /resumeTableQr: \(tableId: string\) =>/);
  assert.match(endpoints, /`\/api\/admin\/tables\/\$\{tableId\}\/qr\/resume`/);
  assert.match(endpoints, /pauseTableQr: \(tableId: string\) =>/);
  assert.match(read("app/api/admin/tables/[tableId]/qr/resume/route.ts"), /export function POST/);
  assert.match(read("app/api/admin/tables/[tableId]/qr/pause/route.ts"), /export function POST/);

  // Paused calls resume, active calls pause — and it is the table's own id.
  assert.match(toggle, /if \(nextPaused\) await adminApi\.pauseTableQr\(tableId\);/);
  assert.match(toggle, /else await adminApi\.resumeTableQr\(tableId\);/);
  assert.match(toggle, /paused \? void changeAccess\(false\) : setConfirmingPause\(true\)/);
  assert.doesNotMatch(toggle, /tableNumber|restaurantId/, "the toggle sends the wrong identifier");

  // One implementation, shared by the QR screen and the table sheet.
  for (const screen of [
    "components/admin/qr-manager.tsx",
    "components/admin/table-detail-sheet.tsx",
  ]) {
    assert.match(read(screen), /<QrAccessToggle/, `${screen} has its own resume`);
    assert.doesNotMatch(read(screen), /resumeTableQr/, `${screen} bypasses the shared toggle`);
  }
});

test("a resume never rotates, and a rotate is still its own action", () => {
  const repository = read("lib/repositories/drizzle-table-repository.ts");
  const access = repository.slice(
    repository.indexOf("private changeQrAccessWithAudit"),
    repository.indexOf("async revokeTokenWithAudit"),
  );
  assert.ok(access.length > 0, "the access-change branch moved");
  // The credential columns are absent from the update by construction.
  assert.doesNotMatch(access, /qrTokenVersion:/, "pause/resume renumbers the credential");
  assert.doesNotMatch(access, /qrTokenHash:/, "pause/resume rewrites the credential");
  assert.match(access, /qrTokenRevokedAt: paused \? changedAt : null/);
  // Null, not undefined: undefined would leave the column untouched.
  assert.doesNotMatch(access, /qrTokenRevokedAt: paused \? changedAt : undefined/);
});

test("a 5xx says what actually threw, in development only", () => {
  // "errorName: TypeError" cost a whole investigation; the stack is the point.
  const route = read("lib/api/admin-route.ts");
  assert.match(route, /function errorDiagnostics/);
  assert.match(route, /if \(process\.env\.NODE_ENV === "production"\) return \{\};/);
  assert.match(route, /errorStack: error instanceof Error \? error\.stack : undefined/);
});

/* ---------------------------------------------------------- simple login -- */

test("each username resolves to its own role", () => {
  const expected: Record<string, string> = {
    admin: "ADMIN",
    mudur: "MANAGER",
    garson: "WAITER",
    mutfak: "KITCHEN",
    kasa: "CASHIER",
  };
  for (const [username, role] of Object.entries(expected)) {
    const account = resolveTestAccount(username, `${username}1234`);
    assert.equal(account?.role, role, `${username} did not resolve to ${role}`);
  }
  // Five usernames, five distinct roles: nothing collapses into one identity.
  assert.equal(new Set(Object.values(expected)).size, 5);
});

test("a username is forgiving about case and a password is not", () => {
  assert.equal(resolveTestAccount("ADMIN", "admin1234")?.role, "ADMIN");
  assert.equal(resolveTestAccount("  Admin  ", "admin1234")?.role, "ADMIN");
  assert.equal(resolveTestAccount("admin", "ADMIN1234"), null);
  assert.equal(resolveTestAccount("admin", "Admin1234"), null);
});

test("a wrong password or an unknown username resolves to nothing", () => {
  assert.equal(resolveTestAccount("admin", "admin123"), null);
  assert.equal(resolveTestAccount("admin", "mudur1234"), null);
  assert.equal(resolveTestAccount("admin", ""), null);
  assert.equal(resolveTestAccount("yok", "yok1234"), null);
  assert.equal(resolveTestAccount("", ""), null);
  // A crafted key must not reach through the map's prototype.
  assert.equal(resolveTestAccount("toString", "toString1234"), null);
  assert.equal(resolveTestAccount("constructor", "constructor1234"), null);
});

test("the simple login is off unless a deployment asks for it", async () => {
  const { isSimpleTestLoginEnabled } = await import("../../lib/auth/simple-test-login");
  const env = (value?: string) =>
    ({ ...(value === undefined ? {} : { ENABLE_SIMPLE_TEST_LOGIN: value }) }) as NodeJS.ProcessEnv;
  assert.equal(isSimpleTestLoginEnabled(env()), false);
  assert.equal(isSimpleTestLoginEnabled(env("false")), false);
  assert.equal(isSimpleTestLoginEnabled(env("1")), false);
  assert.equal(isSimpleTestLoginEnabled(env("TRUE")), false);
  assert.equal(isSimpleTestLoginEnabled(env("true")), true);

  // With the flag off, the ordinary Supabase password login is what runs.
  const login = read("lib/auth/staff-login.ts");
  assert.match(login, /if \(isSimpleTestLoginEnabled\(\) && isTestUsername\(identifier\)\)/);
  assert.match(login, /resolveSupabasePasswordCredential/);
});

test("no account's password is ever changed to make this work", () => {
  const simple = read("lib/auth/simple-test-login.server.ts");
  // The session comes from a one-time token exchange, never a credential write.
  assert.match(simple, /generateLink\(\{ type: "magiclink", email \}\)/);
  assert.match(simple, /verifyOtp\(/);
  assert.doesNotMatch(simple, /updateUserById|resetPasswordForEmail|password:/);
});

test("the login screen asks for a username and a password, and nothing else", () => {
  const form = read("components/staff/login-form.tsx");
  assert.match(form, /Kullanıcı Adı/);
  assert.match(form, />\s*Şifre\s*</);
  assert.match(form, /Giriş Yap/);
  // No address field, no role picker.
  assert.doesNotMatch(form, /E-posta|type="email"|inputMode="email"/);
  assert.doesNotMatch(form, /<select|role[Ss]elect|Rol seç/);
  // One message for every rejection, so nothing can be enumerated from here.
  assert.match(form, /Kullanıcı adı veya şifre hatalı\./);
  // iOS does not zoom a 16px field, and the controls stay thumb-sized.
  assert.match(form, /className="h-12 bg-background pl-10 text-base"/);
  assert.match(form, /min-h-12 w-full text-base/);
});

test("the browser never learns which account a username stands for", () => {
  const form = read("components/staff/login-form.tsx");
  // The mapping and the addresses behind it are server-only.
  assert.doesNotMatch(form, /@sehirlokantasi|@lokanta|ADMIN|MANAGER|WAITER|KITCHEN|CASHIER/);
  assert.doesNotMatch(form, /admin1234|mudur1234|garson1234|mutfak1234|kasa1234/);
  assert.match(read("lib/auth/simple-test-login.server.ts"), /^import "server-only";/m);
});

test("simple login changes who may sign in, never what they may do", () => {
  const simple = read("lib/auth/simple-test-login.server.ts");
  // The profile's own role authorises the session; the username only names it.
  assert.match(simple, /if \(principal\.role !== account\.role\)/);
  assert.match(simple, /resolveStaffPrincipal\(/);
  // Role-based landing stays the one the application already had.
  assert.match(read("lib/auth/staff-login.ts"), /redirectTo: staffHomeForRole\(principal\.role\)/);
});
