import type { Metadata } from "next";
import { CashierDashboard } from "@/components/cashier/cashier-dashboard";

export const metadata: Metadata = {
  title: "Kasa Paneli",
  description: "Açık masa hesaplarını ve ödeme işlemlerini yöneten kasa ekranı.",
};

export default function CashierPage() {
  return <CashierDashboard />;
}
