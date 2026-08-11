import type { Metadata } from "next";
import { MenuExperience } from "@/components/menu/menu-experience";
import { INTRO_SESSION_KEY } from "@/lib/intro-constants";

export const metadata: Metadata = {
  title: "QR Menü",
  description: "Tarihi Şehir Lokantası dijital menüsü",
};

export function generateStaticParams() {
  return [{ tableToken: "demo-table" }];
}

const restoreSessionScript = `try{if(sessionStorage.getItem(${JSON.stringify(INTRO_SESSION_KEY)})==="true"){document.documentElement.dataset.sehirIntro="seen"}}catch{}`;

export default function MenuPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: restoreSessionScript }} />
      <MenuExperience />
    </>
  );
}
