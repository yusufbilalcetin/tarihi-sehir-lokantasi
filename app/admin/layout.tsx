import type { ReactNode } from "react";
import { DEFAULT_RESTAURANT_TIME_ZONE } from "@/lib/domain/report-range";
import { AdminShell } from "@/components/admin/admin-shell";
import { StaffSessionProvider } from "@/components/staff/staff-session-provider";
import { PanelAccessDenied } from "@/components/staff/panel-access-denied";
import { resolvePanelAccess } from "@/lib/auth/current-staff";
import { isDemoLauncherEnabled } from "@/lib/config/demo-launcher";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await resolvePanelAccess("admin");
  if (!access.allowed) {
    return (
      <PanelAccessDenied
        area="admin"
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
      <AdminShell demoLauncherEnabled={isDemoLauncherEnabled()}>{children}</AdminShell>
    </StaffSessionProvider>
  );
}
