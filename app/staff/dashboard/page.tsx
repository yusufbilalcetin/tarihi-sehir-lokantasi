import type { Metadata } from "next";
import { StaffDashboardView } from "@/components/staff/staff-dashboard-view";

export const metadata: Metadata = {
  title: "Garson Özeti",
};

export default function StaffDashboardPage() {
  return <StaffDashboardView />;
}
