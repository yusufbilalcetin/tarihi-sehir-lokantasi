import type { UserRole } from "@/lib/domain/status";

/**
 * Five memorable credentials for demonstrating the system.
 *
 * Showing the panels to someone should not begin with typing a long address
 * and a generated password, so a short username names the role and the server
 * resolves it to the real staff identity behind it. Three properties make that
 * safe rather than merely convenient:
 *
 * - it exists only where a deployment asks for it, by flag, so the ordinary
 *   login is untouched everywhere else;
 * - it changes no password. The account's real credential is never read,
 *   written or reset — the session is minted for an identity that already
 *   exists, through Supabase's own one-time-token exchange;
 * - it grants nothing. Each username resolves to a separate profile and the
 *   role on that profile is what authorises the session, so the five identities
 *   stay as far apart as they were.
 *
 * The usernames are ASCII so they can be typed on any keyboard; the interface
 * around them is Turkish.
 */

const TEST_ACCOUNTS = {
  admin: "ADMIN",
  mudur: "MANAGER",
  garson: "WAITER",
  mutfak: "KITCHEN",
  kasa: "CASHIER",
} as const satisfies Record<string, UserRole>;

export type TestUsername = keyof typeof TEST_ACCOUNTS;

export interface TestAccount {
  readonly username: TestUsername;
  readonly role: UserRole;
}

/**
 * Whether this deployment is serving a real restaurant.
 *
 * The project's existing answer is `VERCEL_ENV === "production"` — see
 * `isDemoLauncherEnabled`. That is kept, and extended for the case Vercel does
 * not describe: a self-hosted Node process has no `VERCEL_ENV` at all, so
 * `NODE_ENV` decides there instead. The order matters. A Vercel *preview* is
 * built with `NODE_ENV=production` while `VERCEL_ENV=preview`, so reading
 * `NODE_ENV` first would shut demonstrations out of the previews they exist
 * for; `VERCEL_ENV` is therefore authoritative whenever it is present.
 */
function isProductionRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const vercelEnvironment = environment.VERCEL_ENV?.trim();
  if (vercelEnvironment) return vercelEnvironment === "production";
  return environment.NODE_ENV?.trim() === "production";
}

/**
 * Off unless a deployment says otherwise — and off in production whatever it
 * says.
 *
 * These five credentials have a published password. On a real restaurant's
 * system `admin` / `admin1234` is not a convenience, it is the whole of the
 * front door: the menu, the staff list, the settings and the takings. So
 * unlike the table launcher, which production may open through a second
 * deliberately-named flag, there is no way to open this one there. A variable
 * copied from a preview environment, left behind by an old configuration, or
 * set by mistake changes nothing on a live deployment.
 *
 * The check lives here rather than in the login route because this is the only
 * gate the simple-login branch has; hardening it hardens `POST /api/staff/login`
 * and anything else that might ever call it, by construction rather than by
 * remembering to.
 *
 * A missing or misspelt value leaves the ordinary Supabase login in place,
 * which is the safe direction for a flag like this to fail in.
 */
export function isSimpleTestLoginEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionRuntime(environment)) return false;
  return environment.ENABLE_SIMPLE_TEST_LOGIN?.trim() === "true";
}

/**
 * The username decides the role; the password is the username with `1234`.
 *
 * Usernames are matched case-insensitively because a phone will capitalise the
 * first letter on its own. The password is not: it is a credential, and a
 * credential that ignores case is a weaker credential for no gain.
 */
export function resolveTestAccount(
  identifier: string,
  password: string,
): TestAccount | null {
  const username = identifier.trim().toLocaleLowerCase("en-US");
  if (!Object.hasOwn(TEST_ACCOUNTS, username)) return null;
  const role = TEST_ACCOUNTS[username as TestUsername];
  return password === `${username}1234` ? { username: username as TestUsername, role } : null;
}

/** True when the username is one of ours, whatever the password was. */
export function isTestUsername(identifier: string): boolean {
  return Object.hasOwn(TEST_ACCOUNTS, identifier.trim().toLocaleLowerCase("en-US"));
}
