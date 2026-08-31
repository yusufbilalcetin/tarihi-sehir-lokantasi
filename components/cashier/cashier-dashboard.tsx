"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  ChevronLeft,
  CircleCheckBig,
  TriangleAlert,
  Clock3,
  CreditCard,
  Ellipsis,
  Printer,
  ReceiptText,
  Split,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/shared/brand-mark";
import { StatusBadge } from "@/components/shared/status-badge";
import { SoundControl } from "@/components/shared/sound-control";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CashierBillItems } from "@/components/cashier/cashier-bill-items";
import { BillOperationsSheet } from "@/components/cashier/bill-operations-sheet";
import { ShiftPanel } from "@/components/cashier/shift-panel";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { staffOrderToViewModel, staffTableToViewModel } from "@/lib/adapters/staff-view-model";
import { ApiClientError, newIdempotencyKey } from "@/lib/api/client";
import { cashierShiftApi, ledgerApi, paymentApi, staffApi, printApi } from "@/lib/api/endpoints";
import { NewEntityTracker } from "@/lib/audio/new-entity-tracker";
import { resolveCashierSelection, sortCashierBills } from "@/lib/domain/cashier-queue";
import { playSound } from "@/lib/audio/sound-effects";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import { formatCurrency, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, Payment, RestaurantTable } from "@/types";

type PaymentMethod = Payment["method"];

interface OpenBill {
  table: RestaurantTable;
  order: Order;
  /** True when the guest has already asked for the bill from the QR menu. */
  billRequested: boolean;
}

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
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [lastPaid, setLastPaid] = useState<
    | { tableName: string; method: PaymentMethod; paymentId: string; amount: string }
    | null
  >(null);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [methodsByTable, setMethodsByTable] = useState<Record<string, PaymentMethod>>({});
  const [collecting, setCollecting] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const notificationTracker = useRef(new NewEntityTracker());

  const loadCashier = useCallback(async (signal: AbortSignal) => {
    const [tables, orders, calls] = await Promise.all([
      staffApi.tables(signal),
      // The till only ever collects a served, unsettled order.
      staffApi.orders({ open: true }, signal),
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

  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

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
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  const openBills = useMemo<readonly OpenBill[]>(() => {
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
    return sortCashierBills(
      tables.flatMap((table) => {
        // Only a served order is collectable; the API rejects anything earlier.
        const order = orders.find(
          (candidate) => candidate.tableId === table.id && candidate.status === "served",
        );
        return order ? [{ table, order, billRequested: billRequestTableIds.has(table.id) }] : [];
      }),
    );
  }, [resource.data]);

  /**
   * A chosen table that leaves the counter clears the panel instead of falling
   * through to another bill. A poll landing between reading a total and
   * pressing Ödemeyi Tamamla could otherwise swap the panel to a different
   * table under the cashier's hand, and payment is not a place to guess.
   */
  const selection = useMemo(
    () => resolveCashierSelection(openBills, selectedTableId),
    [openBills, selectedTableId],
  );
  const selectedBill = selection.bill ?? undefined;
  /**
   * A phone shows one step at a time.
   *
   * Below lg the two panels used to stack, so reaching a check meant scrolling
   * past every open table first. The step is derived from the selection that
   * already exists — an explicit pick is "show me this check", no pick is
   * "show me the counter" — so no second source of truth was added.
   */
  const mobileShowsDetail = selection.reason === "explicit";
  const selectedMethod = selectedBill ? methodsByTable[selectedBill.table.id] ?? "card" : "card";
  const visibleBills = openBills;

  // The ledger is the server's money view of the selected bill; the counter
  // never derives collected or refunded figures itself.
  const selectedOrderId = selectedBill?.order.id ?? null;
  const loadLedger = useCallback(
    (signal: AbortSignal) =>
      selectedOrderId
        ? ledgerApi.get(selectedOrderId, signal)
        : Promise.resolve(null),
    [selectedOrderId],
  );
  const ledger = useApiResource(loadLedger, { enabled: Boolean(selectedOrderId) });
  const refetchLedger = ledger.refetch;
  const ledgerPayments = useMemo(
    () =>
      (ledger.data?.payments ?? [])
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
    [ledger.data],
  );

  const metrics = useMemo(() => {
    const outstanding = openBills.reduce((sum, bill) => sum + bill.order.total, 0);
    return {
      outstanding,
      paymentWaiting: openBills.filter((bill) => bill.billRequested).length,
      unpaidCount: openBills.length,
    };
  }, [openBills]);

  const selectPaymentMethod = (method: PaymentMethod) => {
    if (!selectedBill || collecting) return;
    setMethodsByTable((current) => ({ ...current, [selectedBill.table.id]: method }));
  };

  async function takePayment() {
    if (!selectedBill || collecting || !shiftOpen) return;
    setCollecting(true);
    const bill = selectedBill;
    try {
      const payment = await paymentApi.collect(
        { orderId: bill.order.id, method: API_PAYMENT_METHOD[selectedMethod] },
        newIdempotencyKey(),
      );
      void playSound("payment-success");
      setLastPaid({
        tableName: bill.table.name,
        method: selectedMethod,
        paymentId: payment.paymentId,
        amount: payment.amount,
      });
      setSelectedTableId(null);
      await refetch();
      await refetchShift();
      toast.success(`${bill.table.name} ödemesi alındı`, {
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
  ) : null;

  if (!selectedBill) {
    // "Gone" is not "empty": other tables are still owing. The check this
    // cashier had chosen was settled, reopened or split somewhere else, and
    // saying so is the whole point of refusing to silently pick another one.
    const selectionLost = selection.reason === "gone";
    return (
      <main className="min-h-[100dvh] bg-background p-4 sm:p-6">
        <div className="mx-auto max-w-3xl">
          {shiftSection}
          <div className="mt-6 text-center">
            {selectionLost ? (
              <TriangleAlert className="mx-auto size-10 text-status-warning" aria-hidden="true" />
            ) : (
              <CircleCheckBig className="mx-auto size-10 text-olive" aria-hidden="true" />
            )}
            <h1 className="mt-4 font-heading text-2xl font-semibold">
              {selectionLost
                ? "Seçili hesap artık açık değil"
                : resource.loading
                  ? "Hesaplar yükleniyor…"
                  : "Açık hesap bulunmuyor"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {selectionLost
                ? "Bu hesap başka bir yerde kapatılmış, bölünmüş veya yeniden açılmış olabilir. Ödeme almadan önce listeden tekrar seçin."
                : resource.error
                ? resource.error.message
                : resource.loading
                  ? // While the first read is still in flight nothing is known
                    // yet, so the empty-state sentence below would be a claim
                    // rather than a fact.
                    "Açık masa hesapları getiriliyor."
                  : lastPaid
                    ? `${lastPaid.tableName} hesabı kapatıldı. Yeni bir masa hesabı açıldığında burada görünecek.`
                    : "Servis edilen bir sipariş oluştuğunda burada görünecek."}
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {selectionLost ? (
                <Button
                  type="button"
                  className="h-12 min-w-52 text-base font-bold"
                  onClick={() => setSelectedTableId(null)}
                >
                  Hesap listesine dön
                </Button>
              ) : null}
              <RealtimeStatus status={realtimeStatus} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      {/* One line: the drawer state is the only thing here a cashier acts on. */}
      <header className="border-b border-sidebar-primary/35 bg-sidebar text-[#FBF7EF]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark compact className="size-9 shrink-0 border-gold/35" />
            <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">Kasa</h1>
            <Badge
              className={cn(
                "border",
                shiftOpen
                  ? "border-gold/30 bg-gold/10 text-[#F7E5C2]"
                  : "border-white/25 bg-white/5 text-[#F5EBDD]/80",
              )}
            >
              {shiftOpen ? "Açık Vardiya" : "Kasa Kapalı"}
            </Badge>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <SoundControl />
            <p className="text-lg font-extrabold tabular-nums tracking-tight" suppressHydrationWarning>
              {formatClock(now)}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <section className="mb-4" aria-label="Kasa vardiyası">
          {shiftSection}
        </section>

        {/* The three tiles that used to sit here said what the two panels below
            already say — the open total, how many bills, which ones asked for
            the cheque — and pushed the collect button further down a tablet. */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)] xl:gap-5">
          <Card className={cn("gap-0 py-0", mobileShowsDetail && "hidden lg:block")}>
            <CardHeader className="border-b py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Açık masalar</CardTitle>
                  {/* The one figure the tiles carried that nothing else did. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Toplam {formatCurrency(metrics.outstanding)}
                    {metrics.paymentWaiting > 0 ? ` · ${metrics.paymentWaiting} masa hesap istiyor` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="border-olive/20 bg-olive/[0.06] text-olive">
                  {metrics.unpaidCount} hesap
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-2.5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Açık masa hesapları">
                {visibleBills.length ? visibleBills.map(({ table, order, billRequested }) => {
                  const isSelected = table.id === selectedBill.table.id;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => setSelectedTableId(table.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        "motion-press motion-operational-state min-h-24 rounded-xl border p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-burgundy/35 bg-burgundy/[0.055] shadow-[inset_3px_0_0_#681F25]"
                          : "border-transparent bg-muted/45 hover:border-border hover:bg-muted/70",
                      )}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-lg font-extrabold leading-5 text-foreground">{table.name}</span>
                          <span className="mt-1.5 block text-xs font-medium text-muted-foreground">
                            {order.orderNumber} · {formatElapsed(order.elapsedMinutes)} açık
                          </span>
                        </span>
                        <span className="text-base font-extrabold tabular-nums text-foreground">
                          {formatCurrency(order.total)}
                        </span>
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2">
                        {billRequested ? (
                          <Badge variant="outline" className="border-status-warning/25 bg-status-warning-tint text-status-warning">
                            <ReceiptText className="size-3" aria-hidden="true" /> Hesap istiyor
                          </Badge>
                        ) : (
                          <StatusBadge status={table.status} />
                        )}
                        <span className="text-xs text-muted-foreground">{table.seats} kişilik</span>
                      </span>
                    </button>
                  );
                }) : (
                  <div className="rounded-xl border border-status-success/25 bg-status-success-tint px-4 py-6 text-center">
                    <CircleCheckBig className="mx-auto size-7 text-status-success" aria-hidden="true" />
                    <p className="mt-2 text-sm font-bold text-status-success">Tüm açık hesaplar kapandı</p>
                    <p className="mt-1 text-xs text-status-success">Yeni hesap talepleri burada görünecek.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className={cn("gap-0 py-0", !mobileShowsDetail && "hidden lg:block")}>
            <CardHeader className="border-b px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="-ms-2 mb-1 h-11 gap-1.5 px-2 text-sm font-semibold lg:hidden"
                    onClick={() => setSelectedTableId(null)}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    Hesaplar
                  </Button>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <CardTitle className="text-2xl">{selectedBill.table.name}</CardTitle>
                    <StatusBadge status="pending" label="Ödeme Bekliyor" />
                    <RealtimeStatus status={realtimeStatus} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{selectedBill.order.orderNumber}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {formatElapsed(selectedBill.order.elapsedMinutes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersRound className="size-3.5" aria-hidden="true" />
                      {selectedBill.table.seats} kişilik
                    </span>
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ödenecek toplam</p>
                  <p className="mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight text-burgundy">
                    {formatCurrency(selectedBill.order.total)}
                  </p>
                </div>
              </div>
            </CardHeader>

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
                          setSelectedTableId(null);
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
                      disabled={collecting || !shiftOpen}
                      aria-busy={collecting}
                      className="h-12 w-full bg-burgundy text-base font-bold text-primary-foreground hover:bg-burgundy/90 lg:mt-4"
                      onClick={() => void takePayment()}
                    >
                      <Check className="size-5" aria-hidden="true" />
                      {formatCurrency(selectedBill.order.total)} tahsil et
                    </Button>

                    {/* Split bills, part payments and refunds live in a sheet so
                        the one-tap collection above stays the fast path. */}
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 h-11 w-full font-semibold"
                      disabled={!shiftOpen}
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
      </div>

      {selectedBill ? (
        <BillOperationsSheet
          open={operationsOpen}
          orderId={selectedBill.order.id}
          orderNumber={selectedBill.order.orderNumber}
          tableName={selectedBill.table.name}
          orderTotal={selectedBill.order.total.toFixed(2)}
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
    </main>
  );
}
