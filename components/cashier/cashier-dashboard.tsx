"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarCheck,
  Check,
  ChevronLeft,
  CircleCheckBig,
  CreditCard,
  Ellipsis,
  Printer,
  ReceiptText,
  ShoppingBag,
  Split,
  Store,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CashierBillItems } from "@/components/cashier/cashier-bill-items";
import { BillOperationsSheet } from "@/components/cashier/bill-operations-sheet";
import { ShiftPanel } from "@/components/cashier/shift-panel";
import {
  OperationalBackdrop,
  OperationalAction,
  OperationalActionGrid,
  OperationalHero,
  OperationalHome,
  OperationalMetric,
  OperationalMetricGrid,
  OperationalSectionHeading,
  OperationalTopBar,
} from "@/components/staff/operational-ui";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { staffOrderToViewModel, staffTableToViewModel } from "@/lib/adapters/staff-view-model";
import { ApiClientError, newIdempotencyKey } from "@/lib/api/client";
import { cashierShiftApi, ledgerApi, paymentApi, staffApi, printApi } from "@/lib/api/endpoints";
import { NewEntityTracker } from "@/lib/audio/new-entity-tracker";
import {
  buildCashierBills,
  resolveCashierSelection,
  sortCashierBills,
  summariseCashierMoney,
  type CashierBill,
} from "@/lib/domain/cashier-queue";
import { playSound } from "@/lib/audio/sound-effects";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import { formatCurrency, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Payment } from "@/types";

type PaymentMethod = Payment["method"];

const CASHIER_POLL_MS = 15_000;

const API_PAYMENT_METHOD: Record<PaymentMethod, "CASH" | "CARD" | "OTHER"> = {
  cash: "CASH",
  card: "CARD",
  other: "OTHER",
};

const paymentMethods: {
  id: PaymentMethod;
  label: string;
  description: string;
  icon: typeof Banknote;
}[] = [
  { id: "cash", label: "Nakit", description: "Kasadan ödeme", icon: Banknote },
  { id: "card", label: "Kart", description: "POS ile ödeme", icon: CreditCard },
  { id: "other", label: "Diğer", description: "Alternatif yöntem", icon: Ellipsis },
];

function formatClock(date: Date | null) {
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * The till.
 *
 * Open bills on the left, the selected bill and its payment panel on the right.
 * That structure is what this screen already does well and is left alone; what
 * changed is how far down the page the payment button sits, because on a tablet
 * a cashier was scrolling past summary tiles to reach it mid-service.
 */
export function CashierDashboard() {
  const { name } = useStaffSession();
  // The payable entity is the order. A table can owe two of them at once,
  // and a takeaway order owes one without being a table at all.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [lastPaid, setLastPaid] = useState<
    | { tableName: string; method: PaymentMethod; paymentId: string; amount: string }
    | null
  >(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [methodsByOrder, setMethodsByOrder] = useState<Record<string, PaymentMethod>>({});
  const [collecting, setCollecting] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const notificationTracker = useRef(new NewEntityTracker());

  const loadCashier = useCallback(async (signal: AbortSignal) => {
    const [tables, orders, calls] = await Promise.all([
      staffApi.tables(signal),
      // The till only ever collects a served, unsettled order, and it is the
      // one screen that needs each order's money position: the server derives
      // it, so the counter never adds up payments itself.
      staffApi.orders({ open: true, withBalance: true }, signal),
      staffApi.calls(undefined, signal),
    ]);
    return { tables: tables.tables, orders: orders.orders, calls: calls.calls };
  }, []);
  const resource = useApiResource(loadCashier, { pollMs: CASHIER_POLL_MS });
  const { refetch } = resource;

  // The cash drawer state is its own resource: collection is refused by the
  // backend without an open shift, and the UI must not offer what the server
  // will reject.
  const loadShift = useCallback((signal: AbortSignal) => cashierShiftApi.current(signal), []);
  const shiftResource = useApiResource(loadShift, { pollMs: CASHIER_POLL_MS });
  const refetchShift = shiftResource.refetch;
  const shiftOpen = Boolean(shiftResource.data?.shift);

  useEffect(() => {
    const data = resource.data;
    if (!data) return;
    const notificationIds = [
      ...data.orders
        .filter((order) => order.status.toUpperCase() === "SERVED")
        .map((order) => `order:${order.id}`),
      ...data.calls
        .filter(
          (call) =>
            call.type === "BILL_REQUEST" &&
            (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
        )
        .map((call) => `bill-request:${call.id}`),
    ];
    if (notificationTracker.current.update(notificationIds)) {
      void playSound("cashier-notification");
    }
  }, [resource.data]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  const openBills = useMemo<readonly CashierBill[]>(() => {
    const tables = (resource.data?.tables ?? []).map((table) => staffTableToViewModel(table));
    const orders = (resource.data?.orders ?? []).map((order) => staffOrderToViewModel(order));
    const billRequestTableIds = new Set(
      (resource.data?.calls ?? [])
        .filter(
          (call) =>
            call.type === "BILL_REQUEST" &&
            (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
        )
        .map((call) => call.table.id),
    );

    // Whoever asked to pay comes first, then whoever has waited longest. The
    // list used to render in table order while only the fallback selection
    // preferred a requester, so a guest who pressed "hesap" could sit below
    // three tables who had not.
    return sortCashierBills(buildCashierBills(tables, orders, billRequestTableIds));
  }, [resource.data]);

  /**
   * A chosen order that leaves the counter clears the panel instead of falling
   * through to another bill. Keyed by table, settling one round silently handed
   * the panel to the table's next round; payment is not a place to guess.
   */
  const selection = useMemo(
    () => resolveCashierSelection(openBills, selectedOrderId),
    [openBills, selectedOrderId],
  );
  // Landing on the till is a Home Screen, not an implicit payment decision.
  // A payable only becomes the payment workspace after an explicit order-id
  // selection; resolveCashierSelection still detects a stale chosen order.
  const selectedBill = selectedOrderId ? selection.bill ?? undefined : undefined;
  /**
   * A phone shows one step at a time.
   *
   * Below lg the two panels used to stack, so reaching a check meant scrolling
   * past every open table first. The step is derived from the selection that
   * already exists — an explicit pick is "show me this check", no pick is
   * "show me the counter" — so no second source of truth was added.
   */
  const selectedMethod = selectedBill ? methodsByOrder[selectedBill.order.id] ?? "card" : "card";
  const visibleBills = openBills;

  // The ledger is the server's money view of the selected bill; the counter
  // never derives collected or refunded figures itself.
  const ledgerOrderId = selectedBill?.order.id ?? null;
  const loadLedger = useCallback(
    (signal: AbortSignal) =>
      ledgerOrderId ? ledgerApi.get(ledgerOrderId, signal) : Promise.resolve(null),
    [ledgerOrderId],
  );
  const ledger = useApiResource(loadLedger, { enabled: Boolean(ledgerOrderId) });
  const refetchLedger = ledger.refetch;
  const currentLedger = ledger.data?.orderId === ledgerOrderId ? ledger.data : null;
  const refreshFinancialState = useCallback(() => {
    void refetch();
    void refetchLedger();
    void refetchShift();
  }, [refetch, refetchLedger, refetchShift]);
  const realtimeStatus = useStaffRealtime({ onEvent: refreshFinancialState, onResync: refreshFinancialState });
  const ledgerPayments = useMemo(
    () =>
      (currentLedger?.payments ?? [])
        .filter((payment) => payment.status === "COMPLETED")
        .map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          refundedAmount: payment.refundedAmount,
          method: payment.method,
          at: new Intl.DateTimeFormat("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(payment.processedAt)),
        })),
    [currentLedger],
  );

  // The balances the server derived, added up — not the gross of the orders,
  // and not netted across directions. Null when any bill's balance is missing:
  // a partial answer is not a total, and is not shown as one.
  const money = useMemo(() => summariseCashierMoney(openBills), [openBills]);
  const cashierReady = resource.data !== null;
  const shiftReady = shiftResource.data !== null;

  const statusSummary = (
    <OperationalMetricGrid ariaLabel="Canlı kasa durumu">
      <OperationalMetric
        label="Bekleyen Hesap"
        value={money?.unpaidCount ?? "—"}
        icon={ReceiptText}
        tone="amber"
        ready={cashierReady && money !== null}
        loading={resource.loading}
      />
      <OperationalMetric
        label="Vardiya Tahsilatı"
        value={shiftResource.data?.summary ? formatCurrency(Number(shiftResource.data.summary.netCollected)) : "—"}
        icon={WalletCards}
        tone="green"
        ready={Boolean(shiftResource.data?.summary)}
        loading={shiftResource.loading}
      />
      <OperationalMetric
        label="Kasa"
        value={shiftResource.data?.shift?.register.name ?? "Kapalı"}
        icon={Store}
        tone="teal"
        ready={shiftReady}
        loading={shiftResource.loading}
      />
      <OperationalMetric
        label="Vardiya"
        value={shiftOpen ? "Açık" : "Kapalı"}
        icon={Banknote}
        tone={shiftOpen ? "blue" : "neutral"}
        ready={shiftReady}
        loading={shiftResource.loading}
      />
    </OperationalMetricGrid>
  );

  const selectPaymentMethod = (method: PaymentMethod) => {
    if (!selectedBill || collecting) return;
    setMethodsByOrder((current) => ({ ...current, [selectedBill.order.id]: method }));
  };

  async function takePayment() {
    if (!selectedBill || collecting || !shiftOpen) return;
    if (!currentLedger || ledger.error) return;
    setCollecting(true);
    const bill = selectedBill;
    try {
      const payment = await paymentApi.collect(
        { orderId: bill.order.id, method: API_PAYMENT_METHOD[selectedMethod] },
        newIdempotencyKey(),
      );
      void playSound("payment-success");
      setLastPaid({
        // Already in words on the order: a table name, "Paket Sipariş" or
        // "Kurye Siparişi". The till never reaches for a table it may not have.
        tableName: bill.order.tableName,
        method: selectedMethod,
        paymentId: payment.paymentId,
        amount: payment.amount,
      });
      setSelectedOrderId(null);
      await refetch();
      await refetchShift();
      toast.success(`${bill.order.tableName} ödemesi alındı`, {
        description: `${formatCurrency(Number(payment.amount))} tahsil edildi.`,
      });
    } catch (error) {
      // Never show a paid state for a rejected collection.
      void playSound("error");
      toast.error(error instanceof ApiClientError ? error.message : "Ödeme alınamadı.");
      // A conflict means the bill or the drawer moved under us — already paid,
      // shift closed, check settled elsewhere. Re-read both so the operator is
      // looking at what is actually true before trying again.
      if (error instanceof ApiClientError && error.status === 409) {
        await refetch();
        await refetchShift();
      }
    } finally {
      setCollecting(false);
    }
  }

  async function printReceipt(paymentId: string) {
    if (printingReceipt) return;
    setPrintingReceipt(true);
    try {
      await printApi.send({ documentType: "PAYMENT_RECEIPT", paymentId });
      toast.success("Makbuz yazıcıya gönderildi.");
    } catch (error) {
      // Never rolls back the collection: the money was taken, the paper was not.
      toast.error(error instanceof ApiClientError ? error.message : "Makbuz yazdırılamadı.");
    } finally {
      setPrintingReceipt(false);
    }
  }

  // The till panel is always reachable, including with no open bills: a shift
  // has to be openable before the first guest asks to pay, and closeable after
  // the last one has left.
  const shiftSection = shiftResource.data ? (
    <ShiftPanel
      state={shiftResource.data}
      onChanged={async () => {
        await refetchShift();
        await refetch();
      }}
    />
  ) : shiftResource.error ? (
    <p
      className="rounded-[20px] border border-status-warning/25 bg-status-warning-tint/75 px-4 py-3 text-sm font-semibold text-status-warning"
      role="alert"
    >
      Kasa durumu alınamadı: {shiftResource.error.message}
    </p>
  ) : (
    // Never a heading over nothing: until the drawer answers, the panel is a
    // placeholder that says it is loading rather than an empty promise.
    <div
      className="h-40 animate-pulse rounded-[24px] border border-[#6B4A32]/10 bg-white/48 motion-reduce:animate-none"
      aria-label="Kasa durumu yükleniyor"
    />
  );

  if (!selectedBill) {
    // "Gone" is not "empty": other tables are still owing. The check this
    // cashier had chosen was settled, reopened or split somewhere else, and
    // saying so is the whole point of refusing to silently pick another one.
    const selectionLost = selection.reason === "gone";
    return (
      <OperationalBackdrop>
        <OperationalTopBar
          title="Kasa"
          homeHref="/cashier"
          realtimeStatus={realtimeStatus}
          sound
        />
        <OperationalHome role="cashier">
          <OperationalHero
            title="Kasa"
            person={name}
            description="Tahsilat ana ekranı"
            aside={<span className="hidden text-sm font-bold tabular-nums text-[#5D493B] sm:block" suppressHydrationWarning>{formatClock(now)}</span>}
          />

          <section aria-labelledby="cashier-live-title">
            <h2 id="cashier-live-title" className="sr-only">Canlı kasa durumu</h2>
            {statusSummary}
          </section>

          {resource.error ? (
            <p className="mt-3 rounded-xl border border-status-warning/25 bg-status-warning-tint/75 px-3 py-2 text-sm font-semibold text-status-warning" role="alert">
              {cashierReady
                ? "Hesap listesi yenilenemedi; son alınan durum gösteriliyor."
                : `Hesaplar yüklenemedi: ${resource.error.message}`}
            </p>
          ) : null}

          <section className="mt-6" aria-labelledby="cashier-apps-title">
            <OperationalSectionHeading id="cashier-apps-title" title="Kasa uygulamaları" />
            <OperationalActionGrid className="max-w-md grid-cols-3" ariaLabel="Kasa uygulamaları">
              <OperationalAction label="Bekleyen Hesaplar" icon={ReceiptText} iconClassName="bg-[#E27432]" href="#cashier-payables" badge={money?.unpaidCount || undefined} />
              <OperationalAction label="Kasa İşlemleri" icon={Store} iconClassName="bg-[#7A3040]" href="#cashier-shift" />
              <OperationalAction label="Gün Sonu" icon={CalendarCheck} iconClassName="bg-[#397FC5]" href="#cashier-shift" />
            </OperationalActionGrid>
          </section>

          {!shiftOpen ? (
            <section id="cashier-shift" className="mt-6 scroll-mt-24" aria-labelledby="cashier-shift-title">
              <OperationalSectionHeading
                id="cashier-shift-title"
                title={shiftReady ? "Kasayı aç" : "Kasa durumu"}
              />
              {shiftSection}
            </section>
          ) : null}

          <section id="cashier-payables" className="mt-6 scroll-mt-24" aria-labelledby="cashier-payables-title">
            <OperationalSectionHeading
              id="cashier-payables-title"
              title="Ödeme bekleyenler"
              detail={
                !cashierReady || money === null
                  ? "—"
                  : `Tahsil edilecek ${formatCurrency(Number(money.toCollect))}`
              }
            />

            {selectionLost ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-status-warning/25 bg-status-warning-tint/76 px-4 py-3" role="alert">
                <span className="flex items-center gap-2 text-sm font-semibold text-status-warning">
                  <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
                  Seçili hesap başka bir yerde değişti. Güncel listeden tekrar seçin.
                </span>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setSelectedOrderId(null)}>Tamam</Button>
              </div>
            ) : null}

            {!cashierReady ? (
              resource.loading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Hesaplar yükleniyor">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="h-40 animate-pulse rounded-[24px] border border-[#6B4A32]/10 bg-white/48 motion-reduce:animate-none" />
                  ))}
                </div>
              ) : null
            ) : visibleBills.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Ödeme bekleyen hesaplar">
                {visibleBills.map(({ table, order, billRequested }) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedOrderId(order.id)}
                    className="motion-press group min-h-40 rounded-[24px] border border-white/65 bg-white/62 p-4 text-start shadow-[0_14px_34px_rgba(67,45,29,0.075)] backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A3040] focus-visible:ring-offset-2"
                    aria-label={`${order.tableName}, ${order.orderNumber}, hesabı aç`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-[#E27432] text-white shadow-[0_7px_16px_rgba(43,33,29,0.14)]">
                          {table ? <ReceiptText className="size-6" aria-hidden="true" /> : <ShoppingBag className="size-6" aria-hidden="true" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xl font-extrabold tracking-tight text-[#2B211D]">{order.tableName}</span>
                          <span className="mt-0.5 block text-xs font-medium text-[#706156]">{order.orderNumber} · {formatElapsed(order.elapsedMinutes)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xl font-extrabold tabular-nums text-burgundy">
                        {order.outstanding === null ? "—" : formatCurrency(Number(order.outstanding))}
                      </span>
                    </span>
                    <span className="mt-5 flex items-end justify-between gap-3">
                      <span className="min-w-0 text-xs font-semibold text-[#6E5F54]">
                        <span className="block">{order.items.length} kalem · Servis tamamlandı</span>
                        {billRequested ? <span className="mt-1 block text-status-warning">Hesap istiyor</span> : null}
                      </span>
                      <span className="shrink-0 rounded-xl bg-[#3D2A20] px-3 py-2 text-xs font-bold text-[#FFF9EF]">Hesabı aç</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-white/60 bg-white/56 px-5 py-10 text-center backdrop-blur-sm">
                <CircleCheckBig className="mx-auto size-10 text-status-success" aria-hidden="true" />
                <h3 className="mt-3 text-xl font-bold">Açık hesap bulunmuyor</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {lastPaid ? `${lastPaid.tableName} hesabı kapatıldı.` : "Servis edilen siparişler burada görünecek."}
                </p>
              </div>
            )}
          </section>

          {shiftOpen ? (
            <section id="cashier-shift" className="mt-8 scroll-mt-24" aria-labelledby="cashier-shift-title">
              <OperationalSectionHeading id="cashier-shift-title" title="Kasa işlemleri" />
              {shiftSection}
            </section>
          ) : null}
        </OperationalHome>
      </OperationalBackdrop>
    );
  }

  return (
    <OperationalBackdrop>
      <OperationalTopBar
        title="Kasa"
        homeHref="/cashier"
        realtimeStatus={realtimeStatus}
        sound
        end={
          <p className="hidden text-sm font-extrabold tabular-nums text-[#5D493B] sm:block" suppressHydrationWarning>
            {formatClock(now)}
          </p>
        }
      />

      <OperationalHome role="cashier" className="max-w-[1120px]">
        <Button
          type="button"
          variant="ghost"
          className="mb-3 min-h-11 gap-1.5 px-2 text-sm font-semibold"
          onClick={() => setSelectedOrderId(null)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Tahsilat ana ekranı
        </Button>
        <OperationalHero
          title={selectedBill.order.tableName}
          person={selectedBill.order.outstanding === null ? "Bakiye alınıyor" : `${formatCurrency(Number(selectedBill.order.outstanding))} ödenecek`}
          description={[
            selectedBill.order.orderNumber,
            `${formatElapsed(selectedBill.order.elapsedMinutes)} açık`,
            // A takeaway or courier order seats nobody.
            selectedBill.table ? `${selectedBill.table.seats} kişilik` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          aside={<StatusBadge status="pending" label="Ödeme Bekliyor" />}
        />

        {resource.error ? (
          <p className="mt-3 rounded-xl border border-status-warning/25 bg-status-warning-tint/75 px-3 py-2 text-sm font-semibold text-status-warning" role="alert">
            {cashierReady
              ? "Hesap listesi yenilenemedi; son alınan durum gösteriliyor."
              : `Hesaplar yüklenemedi: ${resource.error.message}`}
          </p>
        ) : null}

        {!shiftOpen ? <section className="mb-4" aria-label="Kasa vardiyası">{shiftSection}</section> : null}

        <div className="mx-auto max-w-4xl">
          <Card className="gap-0 overflow-hidden rounded-[28px] border-white/65 bg-white/68 py-0 shadow-[0_20px_50px_rgba(67,45,29,0.09)] backdrop-blur-md">
            <CardContent className="p-0">
              <div className="border-b border-border px-4 py-4 sm:px-5">
                <h2 className="text-base font-bold">Sipariş kalemleri</h2>
                <CashierBillItems items={selectedBill.order.items} />
              </div>

              <div className="px-4 py-4 sm:px-5 sm:py-5">
                {lastPaid ? (
                  <div className="mb-4 flex flex-col items-center justify-center rounded-xl border border-status-success/25 bg-status-success-tint/80 px-5 py-5 text-center" aria-live="polite">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-status-success text-white">
                      <CircleCheckBig className="size-5" aria-hidden="true" />
                    </div>
                    <h2 className="mt-2 font-heading text-lg font-semibold text-status-success">Ödeme alındı</h2>
                    <p className="mt-1 text-2xl font-extrabold tabular-nums text-status-success">
                      {formatCurrency(Number(lastPaid.amount))}
                    </p>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-status-success">
                      {lastPaid.tableName} hesabı {lastPaid.method === "cash" ? "nakit olarak" : lastPaid.method === "card" ? "kartla" : "diğer yöntemle"} kapatıldı.
                    </p>
                    {/* Printing is best-effort: a receipt that fails to queue
                        does not un-collect the money that was just taken. */}
                    <div className="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={printingReceipt}
                        aria-busy={printingReceipt}
                        className="h-11 font-semibold"
                        onClick={() => void printReceipt(lastPaid.paymentId)}
                      >
                        <Printer className="size-4" aria-hidden="true" />
                        Makbuz Yazdır
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 font-semibold"
                        onClick={() => {
                          setLastPaid(null);
                          setSelectedOrderId(null);
                        }}
                      >
                        Hesaplara Dön
                      </Button>
                    </div>
                  </div>
                ) : null}
                {(
                  <div>
                    <fieldset>
                      <legend className="text-base font-bold">Ödeme yöntemi</legend>
                      <p className="mt-1 text-xs text-muted-foreground">Tahsilat için kullanılacak yöntemi seçin.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Ödeme yöntemi">
                        {paymentMethods.map((method) => {
                          const MethodIcon = method.icon;
                          const isActive = selectedMethod === method.id;

                          return (
                            <button
                              key={method.id}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              onClick={() => selectPaymentMethod(method.id)}
                              className={cn(
                                "motion-press motion-operational-state flex min-h-20 items-center gap-3 rounded-xl border px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                isActive
                                  ? "border-burgundy/45 bg-burgundy/[0.06] text-burgundy"
                                  : "border-border bg-card text-foreground hover:bg-muted/60",
                              )}
                            >
                              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", isActive ? "bg-burgundy text-primary-foreground" : "bg-muted text-muted-foreground")}>
                                <MethodIcon className="size-4.5" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="block font-bold">{method.label}</span>
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{method.description}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    {ledger.error ? (
                      <div className="mt-4 text-sm text-burgundy" role="alert">
                        <p>Bakiye yüklenemedi. Tahsilat öncesinde tekrar deneyin.</p>
                        <Button type="button" variant="outline" className="mt-2" onClick={() => void refetchLedger()}>
                          Bakiyeyi yeniden yükle
                        </Button>
                      </div>
                    ) : null}
                    {/* Disabling the button is convenience only: the backend
                        refuses a collection without an open shift regardless. */}
                    {!shiftOpen ? (
                      <p
                        className="mt-4 rounded-lg border border-burgundy/25 bg-burgundy/[0.05] px-3 py-2 text-sm font-medium text-burgundy"
                        role="status"
                      >
                        Kasa kapalı. Tahsilat ve iade için önce kasayı açın.
                      </p>
                    ) : null}
                    {/* On a phone the check can be long, and the button that
                        takes the money should not be somewhere below it. It
                        sticks to the bottom edge above the home indicator; from
                        lg it sits in the flow, where the panel is short. */}
                    <div className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-5 sm:px-5 lg:static lg:m-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-0 lg:backdrop-blur-none">
                    <Button
                      type="button"
                      size="lg"
                      disabled={collecting || !shiftOpen || !currentLedger || Boolean(ledger.error)}
                      aria-busy={collecting}
                      className="h-12 w-full bg-burgundy text-base font-bold text-primary-foreground hover:bg-burgundy/90 lg:mt-4"
                      onClick={() => void takePayment()}
                    >
                      <Check className="size-5" aria-hidden="true" />
                      {currentLedger ? `${formatCurrency(Number(currentLedger.balance.outstanding))} tahsil et` : "Bakiye yükleniyor…"}
                    </Button>

                    {/* Split bills, part payments and refunds live in a sheet so
                        the one-tap collection above stays the fast path. */}
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-11 w-full font-semibold"
                      disabled={!shiftOpen || !currentLedger || Boolean(ledger.error)}
                      onClick={() => setOperationsOpen(true)}
                    >
                      <Split className="size-4" aria-hidden="true" />
                      Hesabı Böl · Kısmi Ödeme · İade
                    </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {shiftOpen ? <section className="mt-4" aria-label="Kasa vardiyası">{shiftSection}</section> : null}
      </OperationalHome>

      {selectedBill && currentLedger && !ledger.error ? (
        <BillOperationsSheet
          key={selectedBill.order.id}
          open={operationsOpen}
          orderId={selectedBill.order.id}
          orderNumber={selectedBill.order.orderNumber}
          tableName={selectedBill.order.tableName}
          orderTotal={currentLedger.balance.payableTotal}
          payments={ledgerPayments}
          onOpenChange={setOperationsOpen}
          onChanged={async () => {
            await refetch();
            await refetchLedger();
            // A refund inside the sheet moves this shift's drawer figures.
            await refetchShift();
          }}
        />
      ) : null}
    </OperationalBackdrop>
  );
}
