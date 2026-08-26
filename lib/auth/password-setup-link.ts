/**
 * Builds the setup link an operator hands to a new staff member.
 *
 * Supabase's own `action_link` points at the provider's verify endpoint, which
 * redirects to the project's Site URL and drops a recovery session in the
 * browser. This application deliberately does not want that: any valid Supabase
 * session for an active profile is a full staff principal, so a link that
 * establishes one is a way into the panels without ever choosing a password.
 *
 * So the link points at this application instead, carrying only the hashed
 * token. `/api/staff/set-password` redeems it server-side, in memory, and the
 * holder proves themselves the ordinary way afterwards.
 */
const DEFAULT_BASE_URL = "http://localhost:3000";

export function passwordSetupBaseUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (environment.APP_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

export function buildPasswordSetupLink(
  hashedToken: string,
  environment?: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL("/staff/set-password", `${passwordSetupBaseUrl(environment)}/`);
  url.searchParams.set("token_hash", hashedToken);
  return url.toString();
}
