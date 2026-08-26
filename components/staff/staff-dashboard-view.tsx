"use client";

import Link from "next/link";
import { BellRing, ChevronRight, ClipboardList, ReceiptText, TableProperties } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StaffFloor } from "@/components/staff/staff-floor";
import { StaffAttendanceCard } from "@/components/staff/staff-attendance-card";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { useStaffFloor } from "@/components/staff/use-staff-floor";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
});

export function StaffDashboardView() {
  const { name } = useStaffSession();
  const floor = useStaffFloor();
  const { summary } = floor;

  return (
    <div className="space-y-7">
      <PageHeader
        title={`Merhaba ${name}`}
        description={`${dateFormatter.format(new Date())}. Salonun güncel durumunu buradan takip edebilirsin.`}
      />

      <section aria-label="Servis özeti" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Yeni sipariş"
          value={String(summary.newOrderCount)}
          helper="Onay bekliyor"
          icon={ClipboardList}
          tone={summary.newOrderCount > 0 ? "alert" : undefined}
        />
        <StatCard
          label="Garson çağrısı"
          value={String(summary.openCallCount)}
          helper="Yanıt bekliyor"
          icon={BellRing}
          tone={summary.openCallCount > 0 ? "alert" : undefined}
        />
        <StatCard
          label="Hesap talebi"
          value={String(summary.billRequestCount)}
          helper="Kasa bilgilendirildi"
          icon={ReceiptText}
        />
        <StatCard
          label="Aktif masa"
          value={String(summary.activeTableCount)}
          helper={`${summary.tableCount} masadan`}
          icon={TableProperties}
          tone="success"
        />
      </section>

      <StaffAttendanceCard />

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
        <StaffFloor floor={floor} limit={8} compact />
      </section>
    </div>
  );
}
