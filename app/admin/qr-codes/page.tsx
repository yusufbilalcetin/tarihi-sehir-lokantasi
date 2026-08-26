import type { Metadata } from "next";
import { QrManagerModule } from "@/components/admin/qr-codes-module";

export const metadata: Metadata = { title: "QR Kodlar" };

export default function AdminQrManagerPage() {
  return <QrManagerModule />;
}
