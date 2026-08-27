import type { Metadata } from "next";
import { TablesModule } from "@/components/staff/tables-module";

export const metadata: Metadata = {
  title: "Masalar",
};

/**
 * A waiter's sign-in lands here, and what a waiter needs on landing is the
 * floor. The route is kept — it is the role's home in `staffHomeForRole` — and
 * now renders the same single Masalar screen the menu points at, instead of a
 * second, smaller copy of it.
 */
export default function StaffDashboardPage() {
  return <TablesModule />;
}
