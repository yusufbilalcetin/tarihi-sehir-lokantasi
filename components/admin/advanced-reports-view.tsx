"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Info } from "lucide-react";

import {
  ReportFilters,
  reportQuery,
  type ReportFilterState,
} from "@/components/admin/report-filters";
import {
  OrderTimelineSheet,
  ProductDetailSheet,
} from "@/components/admin/report-drilldown-sheets";
import { DashboardSalesChart } from "@/components/admin/admin-charts";
import { useAdminReports } from "@/components/admin/use-admin-reports";
import { EmptyState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminApi } from "@/lib/api/endpoints";
import { toCsv } from "@/lib/domain/csv";
import { staffRoleLabel } from "@/lib/domain/display";
import { formatDay, toLocalDay, type Trend } from "@/lib/domain/report-range";
import {
  PRODUCT_SORTS,
  type ProductReportRow,
  type ProductSort,
} from "@/lib/domain/report-contracts";
import {
  parseReportUrlState,
  serializeReportUrlState,
  type ReportTab,
} from "@/lib/domain/report-url-state";
import { formatCurrency } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

const TAB_LABELS: Readonly<Record<ReportTab, string>> = {
  overview: "Genel",
  products: "Ürünler",
  categories: "Kategoriler",
  staff: "Personel",
  kitchen: "Mutfak",
  finance: "Finans",
  tables: "Masalar",
  review: "İnceleme",
};

const TABS = (Object.keys(TAB_LABELS) as ReportTab[]).map((id) => ({
  id,
  label: TAB_LABELS[id],
}));

const REVIEW_KIND_LABELS = {
  CANCEL: "İptal",
  VOID: "Hesaptan çıkarma",
  REFUND: "İade",
} as const;

function seconds(value: number): string {
  const minutes = Math.floor(value / 60);
  return minutes > 0 ? `${minutes} dk ${value % 60} sn` : `${value} sn`;
}

const SORT_LABELS: Readonly<Record<ProductSort, string>> = {
  QUANTITY_DESC: "En Çok Satan",
  QUANTITY_ASC: "En Az Satan",
  GROSS_DESC: "En Yüksek Brüt Satış",
  NET_DESC: "En Yüksek Net Satış",
  CANCELLED_DESC: "En Fazla İptal",
  VOIDED_DESC: "En Fazla Hesaptan Düşülen",
  NAME_ASC: "Ürün Adı A-Z",
  NAME_DESC: "Ürün Adı Z-A",
};

function TrendBadge({ trend }: { trend: Trend | null }) {
  if (!trend) return null;
  if (trend.direction === "NEW") {
    return <span className="text-xs font-semibold text-olive">Yeni</span>;
  }
  if (trend.direction === "NONE") return null;
  const arrow = trend.direction === "UP" ? "↑" : trend.direction === "DOWN" ? "↓" : "→";
  return (
    <span
      className={cn(
        "text-xs font-semibold tabular-nums",
        trend.direction === "UP" ? "text-olive" : trend.direction === "DOWN" ? "text-burgundy" : "text-muted-foreground",
      )}
    >
      {arrow} %{Math.abs(trend.percentage ?? 0)}
    </span>
  );
}

function Kpi({
  label,
  value,
  trend,
  money = true,
}: {
  label: string;
  value: string;
  trend: Trend | null;
  money?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tabular-nums">
          {money ? formatCurrency(Number(value)) : Number(value).toLocaleString("tr-TR")}
        </p>
        <TrendBadge trend={trend} />
      </div>
    </div>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
      <p className="text-sm font-semibold text-destructive">{message}</p>
      <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={onRetry}>
        Yeniden Dene
      </Button>
    </div>
  );
}

/**
 * Advanced reporting. Every figure is computed by the server for the selected
 * period; this view only formats what the API returns and never re-derives a
 * financial number of its own.
 */
export function AdvancedReportsView() {
  const today = formatDay(toLocalDay(new Date()));
  // A pasted report link must reproduce the same screen; anything unparseable
  // in it falls back to the default period rather than failing.
  const [initial] = useState(() =>
    parseReportUrlState(
      typeof window === "undefined" ? "" : window.location.search,
      { today },
    ),
  );
  const [filters, setFilters] = useState<ReportFilterState>({
    range: initial.range,
    from: initial.from,
    to: initial.to,
    comparison: initial.comparison,
  });
  const [tab, setTab] = useState<ReportTab>(initial.tab);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ProductSort>("QUANTITY_DESC");
  const [includeZeroSales, setIncludeZeroSales] = useState(false);
  const [page, setPage] = useState(1);
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [reviewKind, setReviewKind] = useState<"" | "CANCEL" | "VOID" | "REFUND">("");
  const [reviewStaffId, setReviewStaffId] = useState<string | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [printRows, setPrintRows] = useState<ProductReportRow[] | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const next = serializeReportUrlState({ ...filters, tab });
    window.history.replaceState(null, "", `${window.location.pathname}?${next}`);
  }, [filters, tab]);

  const query = useMemo(() => reportQuery(filters), [filters]);
  const productQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("pageSize", "50");
    params.set("includeZeroSales", String(includeZeroSales));
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [includeZeroSales, page, query, search, sort]);
  const reviewDetailQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    params.set("page", String(reviewPage));
    params.set("pageSize", "50");
    if (reviewKind) params.set("kind", reviewKind);
    if (reviewStaffId) params.set("staffId", reviewStaffId);
    return params.toString();
  }, [query, reviewKind, reviewPage, reviewStaffId]);

  const summary = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportSummary(query, signal), [query]),
  );
  const busiest = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportBusiest(query, signal), [query]),
  );
  /** The fixed fourteen-day series the manager's home used to carry. */
  const trend = useAdminReports();
  const productsResource = useApiResource(
    useCallback(
      (signal: AbortSignal) => adminApi.reportProducts(productQuery, signal),
      [productQuery],
    ),
    { enabled: tab === "products" || tab === "overview" },
  );
  const finance = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportFinance(query, signal), [query]),
    { enabled: tab === "finance" },
  );
  const tables = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportTables(query, signal), [query]),
    { enabled: tab === "tables" },
  );
  const staff = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportStaff(query, signal), [query]),
    { enabled: tab === "staff" },
  );
  const review = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportReviewAlerts(query, signal), [query]),
    { enabled: tab === "review" },
  );
  const reviewDetail = useApiResource(
    useCallback(
      (signal: AbortSignal) => adminApi.reportReviewDetail(reviewDetailQuery, signal),
      [reviewDetailQuery],
    ),
    { enabled: tab === "review" },
  );
  const categoriesResource = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportCategories(query, signal), [query]),
    { enabled: tab === "categories" },
  );
  const kitchen = useApiResource(
    useCallback((signal: AbortSignal) => adminApi.reportKitchen(query, signal), [query]),
    { enabled: tab === "kitchen" },
  );

  function refreshAll() {
    void summary.refetch();
    void busiest.refetch();
    void productsResource.refetch();
    void finance.refetch();
    void tables.refetch();
    void staff.refetch();
    void review.refetch();
    void reviewDetail.refetch();
    void categoriesResource.refetch();
    void kitchen.refetch();
  }

  /** Pages through the API so a printed report is not just the visible page. */
  async function fetchAllProducts() {
    const pageSize = 200;
    const rows: ProductReportRow[] = [];
    for (let current = 1; ; current += 1) {
      const params = new URLSearchParams(productQuery);
      params.set("page", String(current));
      params.set("pageSize", String(pageSize));
      const chunk = await adminApi.reportProducts(params.toString());
      rows.push(...chunk.rows);
      if (rows.length >= chunk.total || chunk.rows.length === 0) break;
    }
    return rows;
  }

  async function printAllProducts() {
    setPrinting(true);
    try {
      setPrintRows(await fetchAllProducts());
    } finally {
      setPrinting(false);
    }
  }

  // Printing waits for the full list to be in the DOM, otherwise the browser
  // captures the page as it was before the rows arrived.
  useEffect(() => {
    if (!printRows) return;
    const done = () => setPrintRows(null);
    window.addEventListener("afterprint", done, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printRows]);

  function downloadProductCsv() {
    const rows = productsResource.data?.rows ?? [];
    const csv = toCsv(
      ["Ürün", "Kategori", "Adet", "Brüt Satış", "İptal", "Hesaptan Düşülen", "Net Satış"],
      rows.map((row) => [
        row.productName,
        row.categoryName ?? "",
        row.soldQuantity,
        row.grossSales,
        row.cancelledQuantity,
        row.voidedQuantity,
        row.netSales,
      ]),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `urun-raporu-${filters.range.toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(
    1,
    Math.ceil((productsResource.data?.total ?? 0) / (productsResource.data?.pageSize ?? 50)),
  );

  return (
    <div className="space-y-5">
      <ReportFilters
        state={filters}
        resolvedLabel={summary.data?.range.label ?? null}
        clamped={false}
        refreshing={summary.refreshing}
        onChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        onRefresh={refreshAll}
      />

      <nav className="print:hidden flex gap-2 overflow-x-auto pb-1" aria-label="Rapor bölümleri">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-lg border px-4 text-sm font-semibold",
              tab === entry.id
                ? "border-burgundy bg-burgundy text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {summary.error && !summary.data ? (
        <SectionError message={summary.error.message} onRetry={() => void summary.refetch()} />
      ) : summary.data ? (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Brüt Satış" value={summary.data.grossSales.value} trend={summary.data.grossSales.trend} />
            <Kpi label="İadeler" value={summary.data.refunds.value} trend={summary.data.refunds.trend} />
            <Kpi label="Net Tahsilat" value={summary.data.netCollected.value} trend={summary.data.netCollected.trend} />
            <Kpi label="Ortalama Hesap" value={summary.data.averageCheck.value} trend={summary.data.averageCheck.trend} />
            <Kpi label="Sipariş" value={summary.data.orderCount.value} trend={summary.data.orderCount.trend} money={false} />
            <Kpi label="Tamamlanan" value={summary.data.completedOrderCount.value} trend={summary.data.completedOrderCount.trend} money={false} />
            <Kpi label="İptal Sipariş" value={summary.data.cancelledOrderCount.value} trend={summary.data.cancelledOrderCount.trend} money={false} />
            <Kpi label="Brüt Tahsilat" value={summary.data.grossCollected.value} trend={summary.data.grossCollected.trend} />
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5" strokeWidth={1.8} />
            Kâr — ürün maliyet verisi henüz kaydedilmediği için hesaplanmıyor.
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Rapor yükleniyor…</p>
      )}

      {tab === "overview" ? (
        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">En Yoğun Saat</p>
            {busiest.data?.busiestHour ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {String(busiest.data.busiestHour.hour).padStart(2, "0")}:00 –{" "}
                  {String((busiest.data.busiestHour.hour + 1) % 24).padStart(2, "0")}:00
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {busiest.data.busiestHour.orderCount} sipariş ·{" "}
                  {formatCurrency(Number(busiest.data.busiestHour.sales))}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Bu dönemde kayıt yok.</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground">En Yoğun Gün</p>
            {busiest.data?.busiestWeekday ? (
              <>
                <p className="mt-1 font-heading text-2xl font-semibold">
                  {busiest.data.busiestWeekday.label}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {busiest.data.busiestWeekday.orderCount} sipariş ·{" "}
                  {formatCurrency(Number(busiest.data.busiestWeekday.sales))}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Bu dönemde kayıt yok.</p>
            )}
          </div>
          {busiest.data?.busiestDate ? (
            <div className="rounded-xl border border-border bg-card p-4 md:col-span-2">
              <p className="text-xs font-semibold text-muted-foreground">En Yoğun Tarih</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {busiest.data.busiestDate.date}
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {busiest.data.busiestDate.orderCount} sipariş ·{" "}
                {formatCurrency(Number(busiest.data.busiestDate.sales))}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/*
        The fortnight trend, where history belongs.

        It used to open the manager's home, above the day's own figures. It
        reads its own fixed fourteen-day window rather than the filter above,
        so the section says so instead of letting the dates disagree silently.
      */}
      {tab === "overview" ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-semibold">Son 14 gün</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sabit 14 günlük eğilim; yukarıdaki tarih aralığından bağımsızdır.
              </p>
            </div>
            <strong className="text-2xl font-extrabold tabular-nums">
              {formatCurrency(Number(trend.reports?.totals.revenue ?? 0))}
            </strong>
          </div>
          {trend.error && !trend.salesSeries.length ? (
            <SectionError message="Satış eğilimi alınamadı." onRetry={() => void trend.refetch()} />
          ) : trend.salesSeries.length ? (
            <DashboardSalesChart data={trend.salesSeries} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {trend.loading ? "Satış verisi yükleniyor…" : "Bu dönemde satış kaydı yok."}
            </p>
          )}
        </section>
      ) : null}

      {tab === "products" || tab === "overview" ? (
        <section className="space-y-3">
          <div className="print:hidden flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <label className="text-sm font-semibold" htmlFor="product-search">
                Ürün ara
              </label>
              <Input
                id="product-search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="min-h-11"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold" htmlFor="product-sort">
                Sırala
              </label>
              <select
                id="product-sort"
                className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium"
                value={sort}
                onChange={(event) => setSort(event.target.value as ProductSort)}
              >
                {PRODUCT_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={includeZeroSales}
                onChange={(event) => {
                  setIncludeZeroSales(event.target.checked);
                  setPage(1);
                }}
              />
              Satışı olmayan ürünleri de göster
            </label>
            <Button type="button" variant="outline" className="min-h-11" onClick={downloadProductCsv}>
              <Download className="size-4" strokeWidth={1.8} />
              CSV İndir
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              aria-busy={printing}
              disabled={printing}
              onClick={() => void printAllProducts()}
            >
              Tüm Ürünleri Yazdır
            </Button>
          </div>

          {productsResource.error && !productsResource.data ? (
            <SectionError
              message="Ürün raporu yüklenemedi."
              onRetry={() => void productsResource.refetch()}
            />
          ) : (productsResource.data?.rows.length ?? 0) === 0 ? (
            <EmptyState
              icon={Info}
              title="Bu tarih aralığında kayıt bulunamadı"
              description="Farklı bir dönem seçerek tekrar deneyebilirsiniz."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Ürün</th>
                      <th className="px-3 py-2 font-semibold">Kategori</th>
                      <th className="px-3 py-2 text-right font-semibold">Adet</th>
                      <th className="px-3 py-2 text-right font-semibold">Brüt</th>
                      <th className="px-3 py-2 text-right font-semibold">İptal</th>
                      <th className="px-3 py-2 text-right font-semibold">Hesaptan Düşülen</th>
                      <th className="px-3 py-2 text-right font-semibold">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(productsResource.data?.rows ?? []).map((row) => (
                      <tr key={`${row.productId}-${row.productName}`} className="border-t border-border">
                        <td className="px-3 py-2 font-semibold">
                          <button
                            type="button"
                            className="text-left underline-offset-2 hover:underline print:no-underline"
                            onClick={() => setOpenProductId(row.productId)}
                          >
                            {row.productName}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.categoryName ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.soldQuantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(Number(row.grossSales))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.cancelledQuantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.voidedQuantity}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(Number(row.netSales))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="print:hidden flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Toplam {productsResource.data?.total ?? 0} ürün · sayfa {page}/{totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Önceki
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "finance" && finance.data ? (
        <section className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Yöntem</th>
                  <th className="px-3 py-2 text-right font-semibold">İşlem</th>
                  <th className="px-3 py-2 text-right font-semibold">Brüt</th>
                  <th className="px-3 py-2 text-right font-semibold">İade</th>
                  <th className="px-3 py-2 text-right font-semibold">Net</th>
                  <th className="px-3 py-2 text-right font-semibold">Pay</th>
                </tr>
              </thead>
              <tbody>
                {finance.data.paymentMethods.map((row) => (
                  <tr key={row.method} className="border-t border-border">
                    <td className="px-3 py-2 font-semibold">{row.method}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.gross))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.refunds))}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatCurrency(Number(row.net))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">%{row.share}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">İptaller</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {finance.data.cancellations.orderCount} sipariş · {finance.data.cancellations.itemCount} kalem
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatCurrency(Number(finance.data.cancellations.itemAmount))}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">Hesaptan Çıkarma</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {finance.data.voids.count}
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatCurrency(Number(finance.data.voids.amount))}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">İadeler</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {finance.data.refunds.count}
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatCurrency(Number(finance.data.refunds.amount))} · ort.{" "}
                {formatCurrency(Number(finance.data.refunds.average))}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "tables" && tables.data ? (
        <section className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Masa</th>
                <th className="px-3 py-2 text-right font-semibold">Sipariş</th>
                <th className="px-3 py-2 text-right font-semibold">Tamamlanan</th>
                <th className="px-3 py-2 text-right font-semibold">Brüt Satış</th>
                <th className="px-3 py-2 text-right font-semibold">Ortalama</th>
                <th className="px-3 py-2 text-right font-semibold">Çağrı</th>
              </tr>
            </thead>
            <tbody>
              {tables.data.tables.map((row) => (
                <tr key={row.tableId} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">{row.tableName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.completedOrderCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.grossSales))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.averageCheck))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.callCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "staff" && staff.data ? (
        <section className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Personel</th>
                <th className="px-3 py-2 font-semibold">Rol</th>
                <th className="px-3 py-2 text-right font-semibold">Açtığı Sipariş</th>
                <th className="px-3 py-2 text-right font-semibold">Açtığı Sipariş Cirosu</th>
                <th className="px-3 py-2 text-right font-semibold">Hesaptan Çıkarma</th>
                <th className="px-3 py-2 text-right font-semibold">Çözülen Çağrı</th>
              </tr>
            </thead>
            <tbody>
              {staff.data.staff.map((row) => (
                <tr key={row.staffId} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">
                    {row.staffName}
                    {row.isActive ? null : (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-bold text-muted-foreground">
                        Pasif
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.role}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.createdOrderCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.createdOrderRevenue))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.voidedItemCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.resolvedCallCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "review" && review.data ? (
        <section className="space-y-3">
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            Bu bölüm bir suçlama değildir. Dönem ortalamasının belirgin şekilde üzerindeki
            oranları yöneticinin incelemesi için listeler.
          </p>
          {review.data.flagged.length === 0 ? (
            <EmptyState
              icon={Info}
              title="İnceleme gerektiren işlem yok"
              description="Bu dönemde ortalamanın belirgin üzerinde bir oran bulunmadı."
            />
          ) : (
            review.data.flagged.map((entry) => (
              <div key={entry.staffId} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle className="size-4 text-copper" strokeWidth={1.8} />
                  <p className="font-semibold">{entry.staffName}</p>
                  <span className="text-xs text-muted-foreground">
                    {staffRoleLabel(entry.role)} · {entry.totalActions} işlem
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {entry.signals.map((signal) => (
                    <li key={signal.kind} className="text-muted-foreground">
                      <span className="font-semibold text-foreground">%{signal.rate}</span>{" "}
                      (ortalama %{signal.peerAverageRate}) — {signal.message}
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  className="print:hidden mt-3 min-h-11"
                  onClick={() => {
                    setReviewStaffId(entry.staffId);
                    setReviewPage(1);
                  }}
                >
                  Kayıtlarını Listele
                </Button>
              </div>
            ))
          )}

          <div className="space-y-3">
            <div className="print:hidden flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="review-kind">
                  İşlem türü
                </label>
                <select
                  id="review-kind"
                  className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium"
                  value={reviewKind}
                  onChange={(event) => {
                    setReviewKind(event.target.value as typeof reviewKind);
                    setReviewPage(1);
                  }}
                >
                  <option value="">Tümü</option>
                  {(Object.keys(REVIEW_KIND_LABELS) as (keyof typeof REVIEW_KIND_LABELS)[]).map(
                    (kind) => (
                      <option key={kind} value={kind}>
                        {REVIEW_KIND_LABELS[kind]}
                      </option>
                    ),
                  )}
                </select>
              </div>
              {reviewStaffId ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setReviewStaffId(null);
                    setReviewPage(1);
                  }}
                >
                  Personel filtresini kaldır
                </Button>
              ) : null}
            </div>

            {reviewDetail.error && !reviewDetail.data ? (
              <SectionError
                message="İnceleme kayıtları yüklenemedi."
                onRetry={() => void reviewDetail.refetch()}
              />
            ) : (reviewDetail.data?.rows.length ?? 0) === 0 ? (
              <EmptyState
                icon={Info}
                title="Bu dönemde kayıt yok"
                description="Seçilen filtrelerle iptal, hesaptan çıkarma veya iade kaydı bulunamadı."
              />
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tarih</th>
                        <th className="px-3 py-2 font-semibold">Tür</th>
                        <th className="px-3 py-2 font-semibold">Personel</th>
                        <th className="px-3 py-2 font-semibold">Sipariş</th>
                        <th className="px-3 py-2 font-semibold">Ürün / Sebep</th>
                        <th className="px-3 py-2 text-right font-semibold">Tutar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reviewDetail.data?.rows ?? []).map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums">
                            {new Date(row.at).toLocaleString("tr-TR")}
                          </td>
                          <td className="px-3 py-2">{REVIEW_KIND_LABELS[row.kind]}</td>
                          <td className="px-3 py-2">
                            {row.staffName}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {staffRoleLabel(row.staffRole)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {row.orderId ? (
                              <button
                                type="button"
                                className="underline-offset-2 hover:underline"
                                onClick={() => setOpenOrderId(row.orderId as string)}
                              >
                                {row.orderNumber ?? "Siparişi aç"}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {row.tableName ? (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {row.tableName}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {[row.productName, row.reason, row.note].filter(Boolean).join(" · ") ||
                              "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatCurrency(Number(row.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="print:hidden flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Toplam {reviewDetail.data?.total ?? 0} kayıt · sayfa {reviewPage}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={reviewPage <= 1}
                      onClick={() => setReviewPage((current) => Math.max(1, current - 1))}
                    >
                      Önceki
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={
                        reviewPage * (reviewDetail.data?.pageSize ?? 50) >=
                        (reviewDetail.data?.total ?? 0)
                      }
                      onClick={() => setReviewPage((current) => current + 1)}
                    >
                      Sonraki
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {tab === "categories" ? (
        categoriesResource.error && !categoriesResource.data ? (
          <SectionError
            message="Kategori raporu yüklenemedi."
            onRetry={() => void categoriesResource.refetch()}
          />
        ) : (categoriesResource.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Info}
            title="Bu tarih aralığında kategori satışı yok"
            description="Farklı bir dönem seçerek tekrar deneyebilirsiniz."
          />
        ) : (
          <section className="space-y-2">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Kategori</th>
                    <th className="px-3 py-2 text-right font-semibold">Adet</th>
                    <th className="px-3 py-2 text-right font-semibold">Sipariş</th>
                    <th className="px-3 py-2 text-right font-semibold">Brüt</th>
                    <th className="px-3 py-2 text-right font-semibold">İptal</th>
                    <th className="px-3 py-2 text-right font-semibold">Hesaptan Düşülen</th>
                    <th className="px-3 py-2 text-right font-semibold">Net</th>
                    <th className="px-3 py-2 text-right font-semibold">Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {(categoriesResource.data ?? []).map((row) => (
                    <tr key={row.categoryId ?? "unknown"} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold">{row.categoryName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.soldQuantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.orderCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(row.grossSales))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.cancelledQuantity}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.voidedQuantity}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatCurrency(Number(row.netSales))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">%{row.share}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" strokeWidth={1.8} />
              Kategori adları güncel menüden okunur; bir kategori sonradan yeniden
              adlandırıldıysa geçmiş satışlar yeni adla listelenir.
            </p>
          </section>
        )
      ) : null}

      {tab === "kitchen" ? (
        kitchen.error && !kitchen.data ? (
          <SectionError
            message="Mutfak raporu yüklenemedi."
            onRetry={() => void kitchen.refetch()}
          />
        ) : !kitchen.data ? (
          <p className="text-sm text-muted-foreground">Rapor yükleniyor…</p>
        ) : (
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                label="Hazırlanan Kalem"
                value={String(kitchen.data.preparedItemCount)}
                trend={null}
                money={false}
              />
              <Kpi
                label="Farklı Ürün"
                value={String(kitchen.data.distinctProductCount)}
                trend={null}
                money={false}
              />
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">En Yoğun Saat</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {kitchen.data.busiestHour
                    ? `${String(kitchen.data.busiestHour.hour).padStart(2, "0")}:00`
                    : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold text-muted-foreground">En Yoğun Gün</p>
                <p className="mt-1 font-heading text-2xl font-semibold">
                  {kitchen.data.busiestWeekday?.label ?? "—"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">Hazırlama Süresi</p>
              {kitchen.data.duration.supported ? (
                <>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    Ortalama {seconds(kitchen.data.duration.value.averageSeconds)} · Medyan{" "}
                    {seconds(kitchen.data.duration.value.medianSeconds)} · %90{" "}
                    {seconds(kitchen.data.duration.value.p90Seconds)}
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {kitchen.data.duration.value.sampleCount} ölçüm
                    {kitchen.data.duration.value.excludedSamples > 0
                      ? ` · ${kitchen.data.duration.value.excludedSamples} kalem eşleşmediği için hariç tutuldu`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {kitchen.data.duration.reason}
                </p>
              )}
            </div>

            {kitchen.data.staff.length === 0 ? (
              <EmptyState
                icon={Info}
                title="Bu dönemde mutfak hareketi yok"
                description="Kalem durumu değişikliği kaydedilmemiş."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Personel</th>
                      <th className="px-3 py-2 text-right font-semibold">Hazırlamaya Aldı</th>
                      <th className="px-3 py-2 text-right font-semibold">Hazır İşaretledi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kitchen.data.staff.map((row) => (
                      <tr key={row.staffId} className="border-t border-border">
                        <td className="px-3 py-2 font-semibold">
                          {row.staffName}
                          {row.isActive ? null : (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-bold text-muted-foreground">
                              Pasif
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.startedPreparationCount}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.markedReadyCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {kitchen.data.topProducts.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[24rem] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">En Çok Hazırlanan Ürün</th>
                      <th className="px-3 py-2 text-right font-semibold">Adet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kitchen.data.topProducts.map((row) => (
                      <tr key={row.productName} className="border-t border-border">
                        <td className="px-3 py-2">{row.productName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.preparedQuantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )
      ) : null}

      {printRows ? (
        <section className="hidden print:block">
          <h2 className="font-heading text-lg font-semibold">
            Ürün Raporu — {summary.data?.range.label ?? ""}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="py-1 text-left font-semibold">Ürün</th>
                <th className="py-1 text-left font-semibold">Kategori</th>
                <th className="py-1 text-right font-semibold">Adet</th>
                <th className="py-1 text-right font-semibold">Brüt</th>
                <th className="py-1 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((row) => (
                <tr key={`${row.productId}-${row.productName}`} className="break-inside-avoid">
                  <td className="py-1">{row.productName}</td>
                  <td className="py-1">{row.categoryName ?? "—"}</td>
                  <td className="py-1 text-right tabular-nums">{row.soldQuantity}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCurrency(Number(row.grossSales))}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCurrency(Number(row.netSales))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {openProductId ? (
        <ProductDetailSheet
          productId={openProductId}
          rangeQuery={query}
          onClose={() => setOpenProductId(null)}
        />
      ) : null}
      {openOrderId ? (
        <OrderTimelineSheet orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
      ) : null}
    </div>
  );
}
