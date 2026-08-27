"use client";

import { ModulePage } from "@/components/shared/module-page";
import { WaiterCallsList } from "@/components/staff/waiter-calls-list";

/** Service requests, as a normal page inside the staff shell. */
export function CallsModule() {
  return (
    <ModulePage
      title="Garson Çağrıları"
      description="Masa taleplerini üstlen ve tamamlananları kapat."
    >
      <WaiterCallsList />
    </ModulePage>
  );
}
