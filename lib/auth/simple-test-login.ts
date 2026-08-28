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
 * Off unless a deployment says otherwise, in as many words. A missing or
 * misspelt value leaves the ordinary login in place rather than opening this
 * one, which is the safe direction for a flag like this to fail in.
 */
export function isSimpleTestLoginEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
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
