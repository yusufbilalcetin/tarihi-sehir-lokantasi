import type { Metadata } from "next";
import { OrdersModule } from "@/components/staff/orders-module";

export const metadata: Metadata = {
  title: "Siparişler",
};

export default function StaffOrdersPage() {
  return <OrdersModule />;
}
