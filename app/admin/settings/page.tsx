import type { Metadata } from "next";
import { SettingsManager } from "@/components/admin/settings-manager";

export const metadata: Metadata = { title: "Ayarlar" };

export default function AdminSettingsPage() {
  return <SettingsManager />;
}
