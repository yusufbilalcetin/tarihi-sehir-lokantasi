import type { Metadata } from "next";
import { OrdersManager } from "@/components/admin/orders-manager";

export const metadata: Metadata = { title: "Siparişler" };

export default function AdminOrdersPage() {
  return <OrdersManager />;
}

