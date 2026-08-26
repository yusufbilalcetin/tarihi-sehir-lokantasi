import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MenuExperience } from "@/components/menu/menu-experience";
import { VALIDATED_TABLE_NUMBER_HEADER } from "@/lib/auth/menu-gate";
import { INTRO_SESSION_KEY } from "@/lib/intro-constants";
import { CSP_NONCE_HEADER } from "@/proxy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tarihi Şehir Lokantası",
  description: "Tarihi Şehir Lokantası QR",
};

const restoreSessionScript = `try{if(sessionStorage.getItem(${JSON.stringify(INTRO_SESSION_KEY)})==="true"){document.documentElement.dataset.sehirIntro="seen"}}catch{}`;

export default async function MenuPage() {
  const requestHeaders = await headers();
  const rawTableNumber = requestHeaders.get(VALIDATED_TABLE_NUMBER_HEADER);
  const tableNumber = rawTableNumber && /^\d{1,6}$/.test(rawTableNumber)
    ? Number(rawTableNumber)
    : null;
  if (!tableNumber || !Number.isSafeInteger(tableNumber)) redirect("/menu/invalid");

  // Next.js nonces the scripts it emits itself, but not one written by hand:
  // without this the intro would be blocked and the splash would replay on
  // every navigation.
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: restoreSessionScript }} />
      <MenuExperience tableNumber={tableNumber} />
    </>
  );
}
