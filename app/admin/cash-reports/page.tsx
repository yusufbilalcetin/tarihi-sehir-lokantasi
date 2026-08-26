import type { Metadata } from "next";
import { CashDayReportViewModule } from "@/components/admin/cash-reports-module";

export const metadata: Metadata = { title: "Gün Sonu Kasa Raporu" };

export default function AdminCashDayReportViewPage() {
  return <CashDayReportViewModule />;
}
