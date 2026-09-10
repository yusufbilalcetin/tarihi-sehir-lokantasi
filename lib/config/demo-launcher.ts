import { isProductionRuntime } from "@/lib/config/runtime-environment";

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
 *
 * "A production deployment" is `isProductionRuntime`, shared with the staff
 * test-login gate. It used to be `VERCEL_ENV === "production"` written out
 * here, which missed the self-hosted case: with no `VERCEL_ENV` to read, a
 * stale `ENABLE_DEMO_LAUNCHER=true` opened the picker on a live server — the
 * precise thing the paragraph above says cannot happen.
 */
export function isDemoLauncherEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (isProductionRuntime(environment)) {
    return environment.ENABLE_PRODUCTION_TABLE_PICKER === "true";
  }
  return environment.ENABLE_DEMO_LAUNCHER === "true";
}
