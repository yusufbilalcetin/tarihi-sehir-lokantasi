import type { Metadata } from "next";
import { PrintersManagerModule } from "@/components/admin/printers-module";

export const metadata: Metadata = { title: "Yazıcılar" };

export default function AdminPrintersManagerPage() {
  return <PrintersManagerModule />;
}
