import type { Metadata } from "next";
import { AuditLogModule } from "@/components/admin/audit-module";

export const metadata: Metadata = { title: "İşlem Geçmişi" };

export default function AdminAuditLogPage() {
  return <AuditLogModule />;
}
