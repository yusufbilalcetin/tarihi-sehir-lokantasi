import type { Metadata } from "next";
import { ErpOperationsModule } from "@/components/admin/erp-operations-module";

export const metadata: Metadata = { title: "İşletme ERP" };

export default function AdminErpPage() { return <ErpOperationsModule />; }
