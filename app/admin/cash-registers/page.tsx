import type { Metadata } from "next";
import { CashRegistersManagerModule } from "@/components/admin/cash-registers-module";

export const metadata: Metadata = { title: "Kasa ve Vardiyalar" };

export default function AdminCashRegistersManagerPage() {
  return <CashRegistersManagerModule />;
}
