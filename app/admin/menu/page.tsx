import type { Metadata } from "next";
import { MenuOverviewModule } from "@/components/admin/menu-module";

export const metadata: Metadata = { title: "Menü Yönetimi" };

export default function AdminMenuOverviewPage() {
  return <MenuOverviewModule />;
}
