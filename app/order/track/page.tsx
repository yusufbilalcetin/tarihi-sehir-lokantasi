import type { Metadata } from "next";

import { OrderTracking } from "@/components/guest/order-tracking";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sipariş Takibi | Tarihi Şehir Lokantası",
  description: "Paket ve kurye siparişinizin durumunu takip edin.",
};

/**
 * The tracking door. It takes nothing: no order number in the path, no
 * identifier in the query string. The signed capability the browser already
 * holds decides which order — if any — this page may show.
 */
export default function OrderTrackingPage() {
  return <OrderTracking />;
}
