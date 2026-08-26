import type { Metadata } from "next";
import { StaffManagerModule } from "@/components/admin/staff-module";

export const metadata: Metadata = { title: "Personel" };

export default function AdminStaffManagerPage() {
  return <StaffManagerModule />;
}
