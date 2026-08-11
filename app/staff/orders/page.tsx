import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { OrdersList } from "@/components/staff/orders-list";

export const metadata: Metadata = {
  title: "Siparişler",
};

export default function StaffOrdersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Siparişler"
        description="Salon siparişlerini filtrele, mutfak durumunu takip et ve servis akışını güncelle."
      />
      <OrdersList />
    </div>
  );
}
