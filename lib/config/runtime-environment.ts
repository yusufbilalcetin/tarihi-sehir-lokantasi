/**
 * What counts as "a production deployment" — decided once, for every gate.
 *
 * Two switches used to answer this separately. `isSimpleTestLoginEnabled` knew
 * that a self-hosted Node process carries no `VERCEL_ENV` and fell back to
 * `NODE_ENV`; `isDemoLauncherEnabled` tested `VERCEL_ENV === "production"` on
 * its own. The second therefore did not do what its own comment promised — on a
 * self-hosted production process a stale `ENABLE_DEMO_LAUNCHER=true` still
 * opened the public table picker, which is the exact "variable copied into
 * production, or left behind by an old configuration" case both guards exist to
 * survive.
 *
 * A security gate that has to be re-derived at every call site drifts. This is
 * the single derivation.
 *
 * The order matters. A Vercel *preview* is built with `NODE_ENV=production`
 * while `VERCEL_ENV=preview`, so reading `NODE_ENV` first would shut
 * demonstrations out of the previews they exist for; `VERCEL_ENV` is therefore
 * authoritative whenever it is present, and `NODE_ENV` decides only where the
 * platform says nothing.
 */
export function isProductionRuntime(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const vercelEnvironment = environment.VERCEL_ENV?.trim();
  if (vercelEnvironment) return vercelEnvironment === "production";
  return environment.NODE_ENV?.trim() === "production";
}
