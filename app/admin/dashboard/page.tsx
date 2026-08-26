import type { Metadata } from "next";
import { DashboardViewModule } from "@/components/admin/dashboard-module";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default function AdminDashboardViewPage() {
  return <DashboardViewModule />;
}
