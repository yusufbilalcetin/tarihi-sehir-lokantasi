const DEFAULT_BASE_URL = "http://localhost:3000";

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin a printed QR code has to point at.
 *
 * Configuration first, because a code glued to a table outlives the deployment
 * that produced it and must never carry a preview host. `VERCEL_URL` is
 * deliberately not consulted for that reason: it names the individual
 * deployment. The request's own origin is the last resort and is what serves
 * local development, where it is `http://localhost:3000`.
 */
export function resolveAppBaseUrl(
  request?: Request,
  environment: Record<string, string | undefined> = process.env,
): string {
  return (
    normalize(environment.APP_BASE_URL) ??
    normalize(environment.VERCEL_PROJECT_PRODUCTION_URL) ??
    (request ? normalize(request.url) : null) ??
    DEFAULT_BASE_URL
  );
}
