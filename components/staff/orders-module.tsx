"use client";

import { ModulePage } from "@/components/shared/module-page";
import { OrdersList } from "@/components/staff/orders-list";

/** Orders, as a normal page inside the staff shell. */
export function OrdersModule() {
  return (
    <ModulePage
      title="Siparişler"
      description="Salon siparişlerini filtrele, mutfak durumunu takip et ve servis akışını güncelle."
    >
      <OrdersList />
    </ModulePage>
  );
}
