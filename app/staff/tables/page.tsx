import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { TableGrid } from "@/components/staff/table-grid";
import { Badge } from "@/components/ui/badge";
import { restaurantTables } from "@/lib/mock-data/tables";

export const metadata: Metadata = {
  title: "Masalar",
};

export default function StaffTablesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Masalar"
        description="Salonun tamamını izle, masa detaylarını aç ve servis işlemlerini hızlıca tamamla."
        action={
          <Badge variant="outline" className="h-8 border-copper/40 bg-card px-3 text-sm text-burgundy">
            {restaurantTables.length} masa
          </Badge>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground" aria-label="Masa durum özeti">
        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">3 boş</span>
        <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-sky-800">3 serviste</span>
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-900">2 bekliyor</span>
        <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-rose-800">3 öncelikli</span>
      </div>

      <TableGrid tables={restaurantTables} />
    </div>
  );
}
