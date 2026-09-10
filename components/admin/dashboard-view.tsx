"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ClipboardList,
  Clock3,
  Grid2X2,
  HandCoins,
  RefreshCw,
  Settings,
  TrendingUp,
  UsersRound,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { readOverview, warningsFor } from "@/components/admin/today-panel";
import { Money } from "@/components/shared/money";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Button } from "@/components/ui/button";
import { staffOrderToViewModel, staffTableToViewModel } from "@/lib/adapters/staff-view-model";
import { adminApi, staffApi } from "@/lib/api/endpoints";
import { restaurantToday } from "@/lib/domain/report-range";
import { LONG_WAIT_MINUTES } from "@/lib/domain/service-attention";
import { isTableOpen } from "@/lib/domain/table-actions";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

const HOME_POLL_MS = 20_000;
export const HOME_ATTENTION_LIMIT = 3;
const NEVER_CHANGES = () => () => undefined;

type HomeShortcut = {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly iconClassName: string;
};

/**
 * The Home Screen is a daily launcher, not a second ownership table.
 *
 * In particular, Stok is a direct shortcut into inventory while N1 continues
 * to own /admin/inventory under Daha Fazla. No navigation context is copied or
 * redefined here.
 */
export const HOME_APP_SHORTCUTS: readonly HomeShortcut[] = [
  { label: "Masalar", href: "/admin/tables", icon: Grid2X2, iconClassName: "bg-[#2f9f67] text-white" },
  { label: "Siparişler", href: "/admin/orders", icon: ClipboardList, iconClassName: "bg-[#cf4b4b] text-white" },
  { label: "Kasa", href: "/admin/cash-registers", icon: Wallet, iconClassName: "bg-[#e27432] text-white" },
  { label: "Raporlar", href: "/admin/reports", icon: ChartNoAxesCombined, iconClassName: "bg-[#357dc7] text-white" },
  { label: "Personel", href: "/admin/staff", icon: UsersRound, iconClassName: "bg-[#7654b8] text-white" },
  { label: "Menü", href: "/admin/menu", icon: BookOpen, iconClassName: "bg-[#e2ad2f] text-[#2b211d]" },
  { label: "Stok", href: "/admin/inventory", icon: Boxes, iconClassName: "bg-[#607d96] text-white" },
  { label: "Ayarlar", href: "/admin/settings", icon: Settings, iconClassName: "bg-[#318c89] text-white" },
];

export function greetingForHour(hour: number): "Günaydın" | "İyi günler" | "İyi akşamlar" {
  if (hour >= 5 && hour < 12) return "Günaydın";
  if (hour >= 12 && hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

function restaurantClock(instant: Date | null, timeZone: string) {
  if (!instant) {
    return { greeting: "Hoş geldiniz", date: "Bugünün işletme özeti" } as const;
  }

  const hour = Number(
    new Intl.DateTimeFormat("tr-TR", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(instant),
  );
  const date = new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(instant);

  return { greeting: greetingForHour(hour), date } as const;
}

function ResourceValue({
  ready,
  error,
  value,
}: {
  readonly ready: boolean;
  readonly error: unknown;
  readonly value: ReactNode;
}) {
  if (ready) return <span className="admin-home-metric-value">{value}</span>;
  return (
    <span className="min-w-0">
      <span className="admin-home-metric-value" aria-hidden="true">—</span>
      <span className="block truncate text-[11px] font-semibold text-[#5f554d]">
        {error ? "Alınamadı" : "Yükleniyor"}
      </span>
    </span>
  );
}

function MobileMetric({
  label,
  href,
  icon: Icon,
  ready,
  error,
  value,
}: {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly ready: boolean;
  readonly error: unknown;
  readonly value: ReactNode;
}) {
  return (
    <Link href={href} className="admin-home-material motion-press group flex min-h-[78px] min-w-0 items-center gap-2.5 rounded-[18px] px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a3040] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-reduce:transition-none">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[11px] bg-white/55 text-[#6f3540] shadow-[inset_0_1px_0_rgba(255,255,255,.6)]">
        <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold leading-4 text-[#5f554d]">{label}</span>
        <ResourceValue ready={ready} error={error} value={value} />
      </span>
      <ArrowUpRight className="size-3.5 shrink-0 text-[#6f6259]/70 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </Link>
  );
}

function DesktopMetric({ href, label, ready, error, value }: { readonly href: string; readonly label: string; readonly ready: boolean; readonly error: unknown; readonly value: ReactNode }) {
  return (
    <Link href={href} className="motion-press min-w-0 rounded-xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a3040] motion-reduce:transition-none">
      <span className="block text-xs font-semibold text-[#675b52]">{label}</span>
      <ResourceValue ready={ready} error={error} value={value} />
    </Link>
  );
}

function AppLauncher() {
  return (
    <section aria-labelledby="home-apps-title" className="min-w-0">
      <h2 id="home-apps-title" className="mb-2.5 text-lg font-semibold tracking-[-0.015em] text-[#2b211d] sm:mb-4 sm:text-xl">
        Uygulamalar
      </h2>
      <div className="grid grid-cols-4 gap-x-2 gap-y-2.5 sm:gap-x-4 sm:gap-y-4">
        {HOME_APP_SHORTCUTS.map((app) => (
          <Link
            key={app.href}
            href={app.href}
            className="motion-press group flex min-h-[82px] min-w-0 flex-col items-center justify-start gap-1.5 rounded-2xl px-0.5 py-0.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a3040] focus-visible:ring-offset-4 focus-visible:ring-offset-transparent sm:min-h-[108px] sm:gap-2 motion-reduce:transition-none"
          >
            <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-[17px] shadow-[0_7px_16px_rgba(43,33,29,.15),inset_0_1px_0_rgba(255,255,255,.24)] transition-transform duration-150 group-hover:-translate-y-0.5 sm:size-[72px] sm:rounded-[21px] motion-reduce:transition-none", app.iconClassName)}>
              <app.icon className="size-7 sm:size-9" strokeWidth={1.9} aria-hidden="true" />
            </span>
            <span className="max-w-full text-[12px] font-semibold leading-4 text-[#2b211d] sm:text-sm">{app.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

type AttentionItem = {
  readonly key: string;
  readonly text: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly urgent?: boolean;
};

function AttentionPanel({
  items,
  pending,
  partialFailure,
  onRetry,
}: {
  readonly items: readonly AttentionItem[];
  readonly pending: boolean;
  readonly partialFailure: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <section aria-labelledby="home-attention-title" className="min-w-0">
      <h2 id="home-attention-title" className="mb-2.5 text-lg font-semibold tracking-[-0.015em] text-[#2b211d] sm:mb-4 sm:text-xl">
        Dikkat gerektirenler
      </h2>
      <div className="admin-home-material overflow-hidden rounded-[22px]">
        {items.length ? (
          <ul className="divide-y divide-white/45">
            {items.slice(0, HOME_ATTENTION_LIMIT).map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="motion-press group flex min-h-14 items-center gap-3 px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7a3040] sm:min-h-16 sm:px-4 motion-reduce:transition-none">
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", item.urgent ? "bg-[#c63f49] text-white" : "bg-[#f0b94b] text-[#38291b]")}>
                    <item.icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-[#332823]">{item.text}</span>
                  <ArrowUpRight className="size-4 shrink-0 text-[#74675e] transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : pending ? (
          <p role="status" className="flex min-h-14 items-center px-4 text-sm font-medium text-[#655950]">Durum kontrol ediliyor…</p>
        ) : partialFailure ? (
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-2.5" role="alert">
            <span className="flex items-center gap-2 text-sm font-semibold text-[#7a3040]"><AlertTriangle className="size-4" aria-hidden="true" />Bazı durum bilgileri alınamadı.</span>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 text-[#6f3540]" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden="true" /> Yenile
            </Button>
          </div>
        ) : (
          <p className="flex min-h-14 items-center gap-2 px-4 text-sm font-semibold text-[#315f47]">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#dcefe3]" aria-hidden="true"><Check className="size-4" /></span>
            Şu anda dikkat gerektiren bir konu yok
          </p>
        )}
        {items.length && partialFailure ? (
          <p role="status" className="border-t border-white/45 px-4 py-2 text-xs font-medium text-[#675b52]">Bazı durumlar kontrol edilemedi.</p>
        ) : null}
      </div>
    </section>
  );
}

export function DashboardView() {
  const { restaurantName, restaurantTimezone } = useStaffSession();
  const clientReady = useSyncExternalStore(NEVER_CHANGES, () => true, () => false);
  const instant = useMemo(() => clientReady ? new Date() : null, [clientReady]);

  const loadOverview = useCallback((signal: AbortSignal) => readOverview(signal), []);
  const overview = useApiResource(loadOverview, { pollMs: HOME_POLL_MS });

  const loadOrders = useCallback((signal: AbortSignal) => staffApi.orders({ open: true }, signal), []);
  const orderResource = useApiResource(loadOrders, { pollMs: HOME_POLL_MS });
  const orders = useMemo(
    () => (orderResource.data?.orders ?? []).map((order) => staffOrderToViewModel(order)),
    [orderResource.data],
  );

  const loadCollections = useCallback(
    (signal: AbortSignal) => adminApi.cashierDayReport(`date=${restaurantToday(restaurantTimezone)}`, signal),
    [restaurantTimezone],
  );
  const collections = useApiResource(loadCollections, { pollMs: HOME_POLL_MS });

  const loadCalls = useCallback((signal: AbortSignal) => staffApi.calls(undefined, signal), []);
  const callResource = useApiResource(loadCalls, { pollMs: HOME_POLL_MS });
  const billRequests = useMemo(
    () => (callResource.data?.calls ?? []).filter(
      (call) => call.type === "BILL_REQUEST" && (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
    ).length,
    [callResource.data],
  );

  const loadTables = useCallback((signal: AbortSignal) => staffApi.tables(signal), []);
  const tableResource = useApiResource(loadTables, { pollMs: HOME_POLL_MS });
  const openTables = useMemo(
    () => (tableResource.data?.tables ?? [])
      .map((table) => staffTableToViewModel(table))
      .filter((table) => isTableOpen(table.status)).length,
    [tableResource.data],
  );

  const lateOrders = useMemo(
    () => orders.filter(
      (order) => !["completed", "cancelled", "served"].includes(order.status) && order.elapsedMinutes >= LONG_WAIT_MINUTES,
    ).length,
    [orders],
  );

  const attentionItems = useMemo<readonly AttentionItem[]>(() => {
    const primary: AttentionItem[] = [];
    if (orderResource.data && lateOrders > 0) primary.push({ key: "late-orders", text: `${lateOrders} sipariş gecikti`, href: "/admin/orders", icon: Clock3, urgent: true });
    if (callResource.data && billRequests > 0) primary.push({ key: "bill-requests", text: `${billRequests} masa hesap bekliyor`, href: "/admin/tables", icon: BellRing, urgent: true });
    const overviewWarnings = overview.data ? warningsFor(overview.data) : [];
    const stockWarning = overviewWarnings.find((warning) => warning.key === "stock");
    if (stockWarning) primary.push({ key: stockWarning.key, text: stockWarning.text, href: stockWarning.href, icon: Boxes });

    const secondary: AttentionItem[] = overviewWarnings
      .filter((warning) => warning.key !== "stock")
      .map((warning) => ({ key: warning.key, text: warning.text, href: warning.href, icon: AlertTriangle }));
    return [...primary, ...secondary].slice(0, HOME_ATTENTION_LIMIT);
  }, [billRequests, callResource.data, lateOrders, orderResource.data, overview.data]);

  const attentionFailure = [overview, orderResource, callResource].some(
    (resource) => Boolean(resource.error) && !resource.data,
  );
  const attentionPending = !attentionFailure && !attentionItems.length && [overview, orderResource, callResource].some(
    (resource) => resource.loading && !resource.data,
  );
  const clock = restaurantClock(instant, restaurantTimezone);
  const restaurant = restaurantName?.trim() || "Tarihi Şehir Lokantası";
  const overviewReady = Boolean(overview.data);
  const collectionsReady = Boolean(collections.data);
  const tablesReady = Boolean(tableResource.data);

  const retryAttention = () => {
    if (overview.error) void overview.refetch();
    if (orderResource.error) void orderResource.refetch();
    if (callResource.error) void callResource.refetch();
  };

  return (
    <section data-admin-home className="admin-home -mx-4 -my-5 min-h-[calc(100dvh-3.5rem)] overflow-hidden px-4 py-4 text-[#2b211d] sm:-mx-6 sm:-my-6 sm:px-6 sm:py-6 lg:-mx-8 lg:-my-8 lg:min-h-[calc(100dvh-4rem)] lg:px-8 lg:py-8">
      <div className="relative z-[1] mx-auto w-full max-w-[1240px]">
        <header className="mb-3.5 sm:mb-6">
          <h1 id="admin-page-title" className="text-[clamp(2.125rem,8vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-[#2b211d]">{clock.greeting}</h1>
          <p className="mt-1.5 text-[17px] font-semibold leading-6 text-[#44372f] sm:text-xl">{restaurant}</p>
          <p className="mt-0.5 text-[13px] font-medium capitalize text-[#66584f] sm:text-sm">{clock.date}</p>
        </header>

        <section aria-labelledby="home-live-title" className="min-w-0">
          <h2 id="home-live-title" className="sr-only">Bugünün canlı özeti</h2>
          <p className="sr-only">Satış ve tahsilat aynı şey değildir; satış yazılan hesabı, tahsilat kasaya giren parayı gösterir.</p>

          <div className="grid grid-cols-2 gap-2.5 md:hidden">
            <MobileMetric label="Bugünkü satış" href="/admin/reports" icon={TrendingUp} ready={overviewReady} error={overview.error} value={overview.data ? <Money amount={overview.data.today.sales} /> : null} />
            <MobileMetric label="Bugünkü tahsilat" href="/admin/cash-reports" icon={HandCoins} ready={collectionsReady} error={collections.error} value={collections.data ? <Money amount={collections.data.netCollected} /> : null} />
            <MobileMetric label="Açık sipariş" href="/admin/orders" icon={ClipboardList} ready={overviewReady} error={overview.error} value={overview.data?.today.openOrders ?? null} />
            <MobileMetric label="Açık masa" href="/admin/tables" icon={Utensils} ready={tablesReady} error={tableResource.error} value={openTables} />
          </div>

          <Link href="/admin/cash-registers" className="admin-home-material motion-press mt-2.5 flex min-h-12 items-center gap-3 rounded-[17px] px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a3040] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent md:hidden motion-reduce:transition-none">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[11px] bg-[#e27432] text-white"><Wallet className="size-[18px]" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-[#65584f]">Kasa durumu</span>
              <span className="block truncate text-sm font-bold text-[#2f2520]">
                {collections.data ? (collections.data.openShiftCount > 0 ? `Açık · ${collections.data.openShiftCount} vardiya` : "Kapalı") : "—"}
              </span>
            </span>
            {!collections.data ? <span className="text-[11px] font-semibold text-[#65584f]">{collections.error ? "Alınamadı" : "Yükleniyor"}</span> : null}
            <ArrowUpRight className="size-4 shrink-0 text-[#75685f]" aria-hidden="true" />
          </Link>

          <div className="hidden gap-3 md:grid md:grid-cols-[1.08fr_1fr_.72fr]">
            <div className="admin-home-material flex min-h-[116px] items-center gap-3 rounded-[24px] px-3 py-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-[#7a3040] text-white"><TrendingUp className="size-5" aria-hidden="true" /></span>
              <span className="grid min-w-0 flex-1 grid-cols-2 gap-4">
                <DesktopMetric href="/admin/reports" label="Bugünkü satış" ready={overviewReady} error={overview.error} value={overview.data ? <Money amount={overview.data.today.sales} /> : null} />
                <DesktopMetric href="/admin/cash-reports" label="Bugünkü tahsilat" ready={collectionsReady} error={collections.error} value={collections.data ? <Money amount={collections.data.netCollected} /> : null} />
              </span>
            </div>
            <div className="admin-home-material flex min-h-[116px] items-center gap-3 rounded-[24px] px-3 py-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-[#357dc7] text-white"><ClipboardList className="size-5" aria-hidden="true" /></span>
              <span className="grid min-w-0 flex-1 grid-cols-2 gap-4">
                <DesktopMetric href="/admin/orders" label="Açık sipariş" ready={overviewReady} error={overview.error} value={overview.data?.today.openOrders ?? null} />
                <DesktopMetric href="/admin/tables" label="Açık masa" ready={tablesReady} error={tableResource.error} value={openTables} />
              </span>
            </div>
            <Link href="/admin/cash-registers" className="admin-home-material motion-press flex min-h-[116px] items-center gap-4 rounded-[24px] px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a3040] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-reduce:transition-none">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-[#e27432] text-white"><Wallet className="size-5" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[#675b52]">Kasa</span>
                <span className="block text-lg font-bold leading-6 text-[#2f2520]">
                  {collections.data ? (collections.data.openShiftCount > 0 ? "Açık" : "Kapalı") : "—"}
                </span>
                {collections.data?.openShiftCount ? <span className="block text-xs font-semibold text-[#675b52]">{collections.data.openShiftCount} vardiya</span> : null}
              </span>
            </Link>
          </div>
        </section>

        <div className="mt-5 grid min-w-0 gap-6 sm:mt-7 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.48fr)] lg:items-start lg:gap-8">
          <AppLauncher />
          <AttentionPanel
            items={attentionItems}
            pending={attentionPending}
            partialFailure={attentionFailure}
            onRetry={retryAttention}
          />
        </div>
      </div>
    </section>
  );
}
