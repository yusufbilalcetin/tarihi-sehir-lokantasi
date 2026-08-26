import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StaffSessionProvider } from "@/components/staff/staff-session-provider";
import { PanelAccessDenied } from "@/components/staff/panel-access-denied";
import { resolvePanelAccess } from "@/lib/auth/current-staff";
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
      role={context.role}
      name={context.name}
      staffId={context.userId}
    >
      <AdminShell>{children}</AdminShell>
    </StaffSessionProvider>
  );
}
