import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OrderStatus, ProductStatus, TableStatus } from "@/types";

type Status = OrderStatus | ProductStatus | TableStatus | "open" | "assigned" | "resolved" | "paid";

const statusConfig: Record<Status, { label: string; className: string }> = {
  available: { label: "Boş", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  occupied: { label: "Dolu", className: "border-stone-300 bg-stone-100 text-stone-800" },
  ordering: { label: "Sipariş Bekliyor", className: "border-amber-200 bg-amber-50 text-amber-900" },
  waiting: { label: "Onay Bekliyor", className: "border-amber-200 bg-amber-50 text-amber-900" },
  dining: { label: "Serviste", className: "border-sky-200 bg-sky-50 text-sky-800" },
  "waiter-call": { label: "Garson Çağrısı", className: "border-rose-200 bg-rose-50 text-rose-800" },
  "bill-requested": { label: "Hesap İstiyor", className: "border-violet-200 bg-violet-50 text-violet-800" },
  cleaning: { label: "Temizleniyor", className: "border-cyan-200 bg-cyan-50 text-cyan-800" },
  pending: { label: "Bekliyor", className: "border-amber-200 bg-amber-50 text-amber-900" },
  confirmed: { label: "Onaylandı", className: "border-blue-200 bg-blue-50 text-blue-800" },
  preparing: { label: "Hazırlanıyor", className: "border-orange-200 bg-orange-50 text-orange-800" },
  ready: { label: "Hazır", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  served: { label: "Servis Edildi", className: "border-sky-200 bg-sky-50 text-sky-800" },
  completed: { label: "Tamamlandı", className: "border-stone-300 bg-stone-100 text-stone-800" },
  cancelled: { label: "İptal", className: "border-red-200 bg-red-50 text-red-800" },
  active: { label: "Aktif", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  inactive: { label: "Pasif", className: "border-stone-300 bg-stone-100 text-stone-700" },
  "sold-out": { label: "Bugün Tükendi", className: "border-rose-200 bg-rose-50 text-rose-800" },
  open: { label: "Bekliyor", className: "border-rose-200 bg-rose-50 text-rose-800" },
  assigned: { label: "Üstlenildi", className: "border-sky-200 bg-sky-50 text-sky-800" },
  resolved: { label: "Çözüldü", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  paid: { label: "Ödendi", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const config = statusConfig[status];
  return <Badge variant="outline" className={cn("whitespace-nowrap font-semibold", config.className, className)}>{label ?? config.label}</Badge>;
}
