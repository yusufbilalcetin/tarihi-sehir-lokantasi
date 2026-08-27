"use client";

import { ModulePage } from "@/components/shared/module-page";
import { OrdersList } from "@/components/staff/orders-list";

/** Orders, as a normal page inside the staff shell. */
export function OrdersModule() {
  return (
    <ModulePage
      title="Siparişler"
      description="Salon siparişlerini takip et ve durumlarını güncelle."
    >
      <OrdersList />
    </ModulePage>
  );
}
