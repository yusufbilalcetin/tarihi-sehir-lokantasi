import type { Metadata } from "next";
import { OrdersManagerModule } from "@/components/admin/orders-module";

export const metadata: Metadata = { title: "Siparişler" };

export default function AdminOrdersManagerPage() {
  return <OrdersManagerModule />;
}
