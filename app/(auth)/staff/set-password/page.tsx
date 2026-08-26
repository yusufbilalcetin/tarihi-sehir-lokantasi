import type { Metadata } from "next";
import { connection } from "next/server";

import { SetPasswordForm } from "@/components/staff/set-password-form";

export const metadata: Metadata = {
  title: "Şifre Belirleme",
  // A setup link is a credential; keep it out of search results entirely.
  robots: { index: false, follow: false },
};

/**
 * Landing page for the one-time setup link produced by
 * `npm run staff:setup-link` and by the panel's password-reset action.
 *
 * The token stays in the URL and is handed to the API by the form; this page
 * never redeems it, so simply opening the link neither signs anyone in nor
 * consumes their one attempt.
 */
export default async function StaffSetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The CSP nonce is issued per request, so this page cannot be prerendered.
  await connection();
  const params = await searchParams;
  const raw = params.token_hash;
  const tokenHash = typeof raw === "string" && raw.trim().length > 0 ? raw : null;

  return <SetPasswordForm tokenHash={tokenHash} />;
}
