/**
 * Whether the prototype table launcher exists in this deployment.
 *
 * Kept out of the launcher service itself — that module is `server-only`, and
 * this switch is the security gate that must stay directly provable: off unless
 * switched on, and never on in a production deployment.
 */
export function isDemoLauncherEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.ENABLE_DEMO_LAUNCHER !== "true") return false;
  // A real deployment marker outranks the flag: setting it in production by
  // accident must not open a second way into a guest session.
  return environment.VERCEL_ENV !== "production";
}
