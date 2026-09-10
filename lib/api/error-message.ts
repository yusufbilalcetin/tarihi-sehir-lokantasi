import { ApiClientError } from "@/lib/api/client";
import { errorCodeMessage } from "@/lib/domain/display";

/**
 * What a failure says to the person at the till or the desk.
 *
 * Every screen used to render `error.message` straight from the wire, so a
 * restaurateur could be shown a bare `CONFLICT`, an HTTP status, or whatever
 * wording a route happened to carry — while a curated Turkish sentence for the
 * same code already existed in `ERROR_CODE_MESSAGES` and was used nowhere.
 *
 * Order of preference:
 *
 *  1. the curated sentence for the code, when there is one;
 *  2. the server's own message, which is already written for staff;
 *  3. the caller's fallback.
 *
 * The code and the status are untouched on the error object, so logging and
 * debugging keep everything this hides from the screen.
 */
export function userErrorMessage(
  error: unknown,
  fallback = "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
): string {
  if (!(error instanceof ApiClientError)) return fallback;

  // A curated sentence wins: it is written for the person reading it, and it
  // cannot regress when a route's own wording changes.
  const curated = errorCodeMessage(error.code, "");
  if (curated) return curated;

  const served = error.message?.trim();
  // Never show a bare code or a status line as if it were a sentence.
  if (!served || served === error.code || /^HTTP \d{3}/i.test(served)) return fallback;
  return served;
}
