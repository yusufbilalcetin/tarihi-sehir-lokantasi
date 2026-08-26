import type { Metadata } from "next";
import { TablesManagerModule } from "@/components/admin/tables-module";

export const metadata: Metadata = { title: "Masalar" };

export default function AdminTablesManagerPage() {
  return <TablesManagerModule />;
}
