import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ChevronRight, ClipboardList, ReceiptText, TableProperties } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { TableGrid } from "@/components/staff/table-grid";
import { buttonVariants } from "@/components/ui/button";
import { restaurantTables } from "@/lib/mock-data/tables";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Garson Özeti",
};

export default function StaffDashboardPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        title="Merhaba Ahmet"
        description="11 Ağustos 2026, Salı. Salonun güncel durumunu buradan takip edebilirsin."
      />

      <section aria-label="Servis özeti" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Yeni sipariş" value="3" helper="Onay bekliyor" icon={ClipboardList} tone="alert" />
        <StatCard label="Garson çağrısı" value="2" helper="Yanıt bekliyor" icon={BellRing} tone="alert" />
        <StatCard label="Hesap talebi" value="1" helper="Kasa bilgilendirildi" icon={ReceiptText} />
        <StatCard label="Aktif masa" value="8" helper="12 masadan" icon={TableProperties} tone="success" />
      </section>

      <section aria-labelledby="dashboard-tables-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="dashboard-tables-title" className="font-heading text-2xl font-semibold tracking-tight">
              Salon durumu
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bir masaya dokunarak sipariş ve servis ayrıntılarını aç.
            </p>
          </div>
          <Link
            href="/staff/tables"
            className={cn(buttonVariants({ variant: "outline" }), "hidden min-h-11 gap-1.5 sm:inline-flex")}
          >
            Tüm Masalar
            <ChevronRight className="size-4" strokeWidth={1.8} />
          </Link>
        </div>
        <TableGrid tables={restaurantTables.slice(0, 8)} compact />
      </section>
    </div>
  );
}
