import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

import { resetFixtureRateLimits } from "./rate-limit-reset";

loadEnvConfig(process.cwd());

/**
 * Phase 9A — the staff panel router and its guard, over real HTTP.
 *
 * The complaint this pins down: a kitchen account opened `/kitchen`, saw the
 * Mutfak screen, and was then moved to `/cashier`. Nothing below reads a
 * component or a mapping table — every case drives the running server the
 * browser talks to and asserts on the status line, the `Location` header and
 * the delivered HTML, because that is the only place a stray redirect can hide.
 *
 * Opt in with a loopback deployment and one JSON map of test accounts:
 *
 *   RUN_PHASE9A_HTTP_E2E=true
 *   PHASE9A_HTTP_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE
 *   PHASE9A_HTTP_E2E_BASE_URL=http://localhost:3100
 *   PHASE9A_STAFF_ACCOUNTS={"kitchen":{"email":"…","password":"…"},…}
 *
 * The suite only reads pages and signs in; it writes nothing but the rate-limit
 * rows its own logins consume, and removes those again.
 */

const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

/** Every guarded staff route, and the panel each one belongs to. */
const ROUTES = [
  "/kitchen",
  "/cashier",
  "/staff/dashboard",
  "/staff/orders",
  "/staff/tables",
  "/staff/calls",
  "/admin/dashboard",
] as const;

type Route = (typeof ROUTES)[number];
type Role = "kitchen" | "cashier" | "waiter" | "manager";

/**
 * A phrase that appears only in that panel's *body*.
 *
 * Deliberately not the page title: a refusal keeps the requested route's
 * `<title>`, so "Kasa Paneli" is present in the document head even when the
 * till was never rendered. Only body copy distinguishes the two.
 */
const PANEL_MARKER: Record<Route, string> = {
  "/kitchen": "Mutfak Ekranı</h1>",
  "/cashier": "Hesaplar yükleniyor",
  "/staff/dashboard": 'aria-label="Personel menüsü"',
  "/staff/orders": 'aria-label="Personel menüsü"',
  "/staff/tables": 'aria-label="Personel menüsü"',
  "/staff/calls": 'aria-label="Personel menüsü"',
  "/admin/dashboard": "Yönetim Merkezi",
};

const DENIED_MARKER = "Bu panele erişim yetkiniz yok";

/** The product decision: a wrong role is refused in place, never redirected. */
const ALLOWED: Record<Role, readonly Route[]> = {
  kitchen: ["/kitchen"],
  cashier: ["/cashier"],
  waiter: ["/staff/dashboard", "/staff/orders", "/staff/tables", "/staff/calls"],
  manager: ROUTES,
};

const HOME: Record<Role, Route> = {
  kitchen: "/kitchen",
  cashier: "/cashier",
  waiter: "/staff/dashboard",
  manager: "/admin/dashboard",
};

interface Account {
  readonly email: string;
  readonly password: string;
}

function readTarget(): { url: URL; accounts: Record<Role, Account> } | { reason: string } {
  if (process.env.RUN_PHASE9A_HTTP_E2E !== "true") {
    return { reason: "Phase 9A HTTP E2E is opt-in; set RUN_PHASE9A_HTTP_E2E=true." };
  }
  if (process.env.PHASE9A_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE9A_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE9A_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE9A_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE9A_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 9A HTTP E2E only targets a loopback server." };
  }
  const accountsJson = process.env.PHASE9A_STAFF_ACCOUNTS;
  if (!accountsJson) return { reason: "PHASE9A_STAFF_ACCOUNTS (JSON) is required." };
  let accounts: Record<Role, Account>;
  try {
    accounts = JSON.parse(accountsJson) as Record<Role, Account>;
  } catch {
    return { reason: "PHASE9A_STAFF_ACCOUNTS must be valid JSON." };
  }
  const missing = (Object.keys(ALLOWED) as Role[]).filter(
    (role) => !accounts[role]?.email || !accounts[role]?.password,
  );
  if (missing.length > 0) {
    return { reason: `PHASE9A_STAFF_ACCOUNTS is missing: ${missing.join(", ")}.` };
  }
  return { url, accounts };
}

/**
 * Only the login limiter's own rows are deleted, so this suite deliberately
 * does not demand the disposable-project gate the order/payment suites need:
 * it reads pages and signs in, and writes no business data. The database it
 * cleans is by definition the one the loopback deployment under test uses.
 */
const databaseUrl =
  process.env.PHASE9A_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

const target = readTarget();

if ("reason" in target || !databaseUrl) {
  test(
    "Phase 9A staff routing HTTP E2E",
    {
      skip:
        "reason" in target
          ? target.reason
          : "PHASE9A_DATABASE_URL or DATABASE_URL is required to clear the login limiter.",
    },
    () => undefined,
  );
} else {
  const baseUrl = target.url;
  const accounts = target.accounts;
  const identifiers = Object.values(accounts).map((account) => account.email);
  const sql = postgres(databaseUrl, {
    max: 2,
    prepare: false,
    onnotice: () => {},
  });

  let assertions = 0;
  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  interface Visit {
    readonly status: number;
    readonly location: string | null;
    readonly html: string;
  }

  class Session {
    private readonly cookies = new Map<string, string>();

    private header(): string {
      return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    private absorb(response: Response): void {
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        // A cleared cookie must leave the jar, or the next request presents a
        // dead session and the guard's own answer is never exercised.
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }

    async login(role: Role): Promise<{ status: number; redirectTo?: string }> {
      // The limiter is deliberately strict (5 per 15 minutes, per IP and per
      // identifier); only the keys these logins produce are cleared.
      await resetFixtureRateLimits(sql, identifiers);
      const response = await fetch(new URL("/api/staff/login", baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl.origin },
        body: JSON.stringify({
          identifier: accounts[role].email,
          password: accounts[role].password,
        }),
        redirect: "manual",
      });
      this.absorb(response);
      const body = (await response.json().catch(() => ({}))) as { redirectTo?: string };
      return { status: response.status, redirectTo: body.redirectTo };
    }

    async post(path: string): Promise<number> {
      const response = await fetch(new URL(path, baseUrl), {
        method: "POST",
        headers: { Cookie: this.header(), Origin: baseUrl.origin },
        redirect: "manual",
      });
      this.absorb(response);
      return response.status;
    }

    /** `redirect: "manual"` is the point: a hop must be visible, not followed. */
    async visit(path: string): Promise<Visit> {
      const response = await fetch(new URL(path, baseUrl), {
        headers: { Cookie: this.header(), Accept: "text/html" },
        redirect: "manual",
      });
      this.absorb(response);
      return {
        status: response.status,
        location: response.headers.get("location"),
        html: response.status === 200 ? await response.text() : "",
      };
    }
  }

  describe("Phase 9A staff panel routing over HTTP", { concurrency: false }, () => {
    after(async () => {
      try {
        await resetFixtureRateLimits(sql, identifiers);
      } catch (error) {
        console.error("PHASE9A HTTP CLEANUP:", (error as Error).message);
      }
      await sql.end({ timeout: 5 });
      console.log(`phase9a http assertions executed: ${assertions}`);
    });

    test("login sends each role to its own panel, and nobody to the till by default", async () => {
      for (const role of Object.keys(ALLOWED) as Role[]) {
        const session = new Session();
        const result = await session.login(role);
        check(result.status === 200, `${role} signs in (got ${result.status})`);
        check(
          result.redirectTo === HOME[role],
          `${role} is sent to ${HOME[role]} (got ${result.redirectTo})`,
        );
      }
    });

    test("a kitchen account opening /kitchen stays on /kitchen with the kitchen screen", async () => {
      const session = new Session();
      await session.login("kitchen");

      // Three consecutive loads: the first navigation, and the two a refresh
      // and a hard refresh produce. A guard that only misbehaves once would
      // still be caught here.
      for (const attempt of [1, 2, 3]) {
        const visit = await session.visit("/kitchen");
        check(visit.status === 200, `attempt ${attempt} renders (got ${visit.status})`);
        check(visit.location === null, `attempt ${attempt} issues no redirect`);
        check(
          visit.html.includes(PANEL_MARKER["/kitchen"]),
          `attempt ${attempt} shows the kitchen screen`,
        );
        check(
          !visit.html.includes(PANEL_MARKER["/cashier"]),
          `attempt ${attempt} carries no cashier panel`,
        );
        check(
          !visit.html.includes("Kasa Paneli"),
          `attempt ${attempt} does not even name the till`,
        );
        check(
          !visit.html.includes(DENIED_MARKER),
          `attempt ${attempt} is not a refusal`,
        );
      }
    });

    test("the kitchen document never names /cashier as somewhere to go", async () => {
      const session = new Session();
      await session.login("kitchen");
      const visit = await session.visit("/kitchen");
      // The redirect used to arrive inside the streamed payload rather than as
      // a status line, so the body is checked too.
      for (const pattern of [/"\/cashier"/, /replace\(\\?"\/cashier/, /push\(\\?"\/cashier/]) {
        check(
          !pattern.test(visit.html),
          `the kitchen document must not carry ${pattern}`,
        );
      }
    });

    test("a wrong-role visitor is refused in place, on the URL they asked for", async () => {
      for (const role of Object.keys(ALLOWED) as Role[]) {
        const session = new Session();
        await session.login(role);
        for (const route of ROUTES) {
          const visit = await session.visit(route);
          const allowed = ALLOWED[role].includes(route);
          check(visit.status === 200, `${role} → ${route} answers 200 (got ${visit.status})`);
          check(visit.location === null, `${role} → ${route} is never redirected`);
          if (allowed) {
            check(
              visit.html.includes(PANEL_MARKER[route]) && !visit.html.includes(DENIED_MARKER),
              `${role} → ${route} opens the panel`,
            );
          } else {
            check(
              visit.html.includes(DENIED_MARKER),
              `${role} → ${route} is refused`,
            );
            check(
              !visit.html.includes(PANEL_MARKER[route]),
              `${role} → ${route} refuses without painting the panel`,
            );
          }
        }
      }
    });

    test("an anonymous visitor is sent to the login page and nowhere else", async () => {
      const session = new Session();
      for (const route of ROUTES) {
        const visit = await session.visit(route);
        check(visit.status === 307, `${route} redirects an anonymous visitor`);
        check(
          visit.location?.endsWith("/staff/login") === true,
          `${route} redirects to the login page (got ${visit.location})`,
        );
      }
    });

    test("signing out and back in returns the kitchen account to the kitchen", async () => {
      const session = new Session();
      await session.login("kitchen");
      const signOut = await session.post("/api/staff/logout");
      check(signOut < 500, `logout answers (got ${signOut})`);
      const afterLogout = await session.visit("/kitchen");
      check(
        afterLogout.status === 307 && afterLogout.location?.endsWith("/staff/login") === true,
        `an expired session goes to the login page (got ${afterLogout.status})`,
      );

      const second = new Session();
      const result = await second.login("kitchen");
      check(result.redirectTo === "/kitchen", `the second login returns to /kitchen`);
      const visit = await second.visit("/kitchen");
      check(visit.status === 200 && visit.location === null, "and the panel opens directly");
      check(visit.html.includes(PANEL_MARKER["/kitchen"]), "with the kitchen screen");
    });
  });
}
