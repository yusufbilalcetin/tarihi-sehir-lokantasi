import type { Metadata } from "next";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

export const metadata: Metadata = {
  title: "Mutfak Ekranı",
  description: "Aktif siparişlerin hazırlık durumunu yöneten mutfak operasyon ekranı.",
};

export default function KitchenPage() {
  return <KitchenBoard />;
}
