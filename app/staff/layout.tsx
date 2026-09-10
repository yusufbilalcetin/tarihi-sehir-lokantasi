import type { ReactNode } from "react";
import { DEFAULT_RESTAURANT_TIME_ZONE } from "@/lib/domain/report-range";
import { StaffSessionProvider } from "@/components/staff/staff-session-provider";
import { StaffShell } from "@/components/staff/staff-shell";
import { PanelAccessDenied } from "@/components/staff/panel-access-denied";
import { resolvePanelAccess } from "@/lib/auth/current-staff";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";

// /staff/login lives in the (auth) route group so this layout guards every
// authenticated staff page in one place.
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const access = await resolvePanelAccess("staff");
  if (!access.allowed) {
    return (
      <PanelAccessDenied
        area="staff"
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
      <StaffShell>{children}</StaffShell>
    </StaffSessionProvider>
  );
}
