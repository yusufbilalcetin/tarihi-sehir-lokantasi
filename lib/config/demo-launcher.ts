/**
 * Whether the table launcher exists in this deployment.
 *
 * Kept out of the launcher service itself — that module is `server-only`, and
 * this switch is the security gate that must stay directly provable: off
 * unless switched on, in every environment.
 *
 * Two flags, deliberately not one. A production deployment ignores
 * `ENABLE_DEMO_LAUNCHER` entirely, so a preview variable copied into
 * production — or left behind by an old configuration — cannot open a second
 * way into a guest session. Opening it there is its own decision, spelled out
 * by its own name.
 */
export function isDemoLauncherEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.VERCEL_ENV === "production") {
    return environment.ENABLE_PRODUCTION_TABLE_PICKER === "true";
  }
  return environment.ENABLE_DEMO_LAUNCHER === "true";
}
