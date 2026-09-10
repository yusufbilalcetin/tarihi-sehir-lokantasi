import type { Metadata } from "next";
import { DEFAULT_RESTAURANT_TIME_ZONE } from "@/lib/domain/report-range";
import { KitchenModule } from "@/components/kitchen/kitchen-module";
import { StaffSessionProvider } from "@/components/staff/staff-session-provider";
import { PanelAccessDenied } from "@/components/staff/panel-access-denied";
import { resolvePanelAccess } from "@/lib/auth/current-staff";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";

export const metadata: Metadata = {
  title: "Mutfak Ekranı",
  description: "Aktif siparişlerin hazırlık durumunu yöneten mutfak operasyon ekranı.",
};

export default async function KitchenPage() {
  const access = await resolvePanelAccess("kitchen");
  if (!access.allowed) {
    return (
      <PanelAccessDenied
        area="kitchen"
        roleLabel={STAFF_ROLE_LABELS[access.role]}
        home={access.home}
      />
    );
  }
  const context = access.context;

  return (
    <StaffSessionProvider
      restaurantId={context.restaurantId}
      restaurantName={context.restaurant?.name ?? null}
      restaurantTimezone={context.restaurant?.timezone ?? DEFAULT_RESTAURANT_TIME_ZONE}
      role={context.role}
      name={context.name}
      staffId={context.userId}
    >
      <KitchenModule />
    </StaffSessionProvider>
  );
}
