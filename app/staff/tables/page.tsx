import type { Metadata } from "next";
import { TablesModule } from "@/components/staff/tables-module";

export const metadata: Metadata = {
  title: "Masalar",
};

export default function StaffTablesPage() {
  return <TablesModule />;
}
