import type { Metadata } from "next";
import { MenuOverview } from "@/components/admin/menu-overview";

export const metadata: Metadata = { title: "Menü Yönetimi" };

export default function AdminMenuPage() {
  return <MenuOverview />;
}
