import type { Metadata } from "next";
import { AdvancedReportsViewModule } from "@/components/admin/reports-module";

export const metadata: Metadata = { title: "Raporlar" };

export default function AdminAdvancedReportsViewPage() {
  return <AdvancedReportsViewModule />;
}
