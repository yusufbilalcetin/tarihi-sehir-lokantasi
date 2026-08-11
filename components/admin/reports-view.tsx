"use client";

import { useState } from "react";
import { CalendarDays, Clock3, Download, ReceiptText, ShoppingBasket, Star, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { AdminKpi, AdminPageHeader, AdminPanel, Field } from "@/components/admin/admin-ui";
import { CategorySalesChart, HourlyOrdersChart, ReportSalesChart } from "@/components/admin/admin-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bestSellers } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const periods = ["Bugün", "Dün", "Bu Hafta", "Bu Ay", "Tarih Aralığı"] as const;
type Period = (typeof periods)[number];

const periodValues: Record<Exclude<Period, "Tarih Aralığı">, { sales: string; orders: string; average: string; helper: string }> = {
  Bugün: { sales: "18.420 ₺", orders: "74", average: "248 ₺", helper: "11 Ağustos" },
  Dün: { sales: "16.390 ₺", orders: "68", average: "241 ₺", helper: "10 Ağustos" },
  "Bu Hafta": { sales: "116.340 ₺", orders: "468", average: "249 ₺", helper: "11-17 Ağustos" },
  "Bu Ay": { sales: "384.760 ₺", orders: "1.548", average: "249 ₺", helper: "Ağustos 2026" },
};

export function ReportsView() {
  const [period, setPeriod] = useState<Period>("Bu Hafta");
  const [startDate, setStartDate] = useState("2026-08-01");
  const [endDate, setEndDate] = useState("2026-08-11");
  const metrics = period === "Tarih Aralığı" ? { sales: "241.870 ₺", orders: "968", average: "250 ₺", helper: "Seçili tarih aralığı" } : periodValues[period];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Raporlar"
        description="Satış performansını, ürün dağılımını ve yoğun saatleri karşılaştırmalı olarak inceleyin."
        actions={<Button className="h-10" onClick={() => toast.success("Demo rapor dosyası hazırlanıyor.")}><Download /> Raporu İndir</Button>}
      />

      <div className="rounded-2xl border bg-card p-3 shadow-[0_12px_35px_rgba(74,40,40,0.05)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" role="group" aria-label="Rapor dönemi">
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                className={cn("h-9 shrink-0 rounded-lg px-3 text-xs font-bold transition-colors", period === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {item}
              </button>
            ))}
          </div>
          {period === "Tarih Aralığı" ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:ml-auto">
              <Field label="Başlangıç" className="grid-cols-[70px_150px] items-center gap-2 text-xs"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-9 bg-background" /></Field>
              <Field label="Bitiş" className="grid-cols-[40px_150px] items-center gap-2 text-xs"><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-9 bg-background" /></Field>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground lg:ml-auto lg:pr-2"><CalendarDays className="size-4" /> {metrics.helper}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <AdminKpi label="Toplam Satış" value={metrics.sales} icon={TrendingUp} change={9.6} changeLabel="önceki döneme göre" inverse />
        <AdminKpi label="Sipariş" value={metrics.orders} icon={ReceiptText} change={6.4} changeLabel="önceki döneme göre" />
        <AdminKpi label="Ortalama Sepet" value={metrics.average} icon={ShoppingBasket} change={2.8} changeLabel="önceki döneme göre" />
        <AdminKpi label="En Çok Satan" value="Kuzu Tandır" icon={Star} helper="28 adet" />
        <AdminKpi label="En Yoğun Saat" value="19:00" icon={Clock3} helper="21 sipariş" />
      </div>

      <AdminPanel
        title="Satış trendi"
        description="Bordo alan satış tutarını, bakır çizgi sipariş adedini gösterir."
        action={<span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{metrics.helper}</span>}
      >
        <ReportSalesChart />
      </AdminPanel>

      <div className="grid gap-6 xl:grid-cols-2">
        <AdminPanel title="Kategori dağılımı" description="Toplam satış içindeki pay"><CategorySalesChart /></AdminPanel>
        <AdminPanel title="Saat bazında sipariş" description="Gün içindeki sipariş yoğunluğu"><HourlyOrdersChart /></AdminPanel>
      </div>

      <AdminPanel title="Ürün performansı" description="Seçili dönemde en yüksek adet ve ciro oluşturan ürünler" contentClassName="p-0 sm:p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b bg-muted/25 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Sıra</th><th className="px-3 py-3 font-semibold">Ürün</th><th className="px-3 py-3 text-right font-semibold">Satış</th><th className="px-5 py-3 text-right font-semibold">Ciro</th></tr></thead>
            <tbody className="divide-y">{bestSellers.map((item, index) => <tr key={item.name} className="hover:bg-muted/20"><td className="px-5 py-3.5 font-heading font-bold text-burgundy">{String(index + 1).padStart(2, "0")}</td><td className="px-3 py-3.5 font-extrabold">{item.name}</td><td className="px-3 py-3.5 text-right font-bold tabular-nums">{item.count} adet</td><td className="px-5 py-3.5 text-right font-extrabold tabular-nums">{formatCurrency(item.revenue)}</td></tr>)}</tbody>
          </table>
        </div>
      </AdminPanel>
    </div>
  );
}

