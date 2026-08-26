import type { Metadata } from "next";
import { SettingsManagerModule } from "@/components/admin/settings-module";

export const metadata: Metadata = { title: "Ayarlar" };

export default function AdminSettingsManagerPage() {
  return <SettingsManagerModule />;
}
