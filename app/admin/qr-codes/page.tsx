import type { Metadata } from "next";
import { QrManager } from "@/components/admin/qr-manager";

export const metadata: Metadata = { title: "QR Kodlar" };

export default function AdminQrCodesPage() {
  return <QrManager />;
}
