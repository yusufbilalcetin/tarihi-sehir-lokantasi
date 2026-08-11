"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Check,
  CircleCheckBig,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Ellipsis,
  ReceiptText,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/shared/brand-mark";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { orders, restaurantTables } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { Order, Payment, RestaurantTable } from "@/types";

type PaymentMethod = Payment["method"];

interface OpenBill {
  table: RestaurantTable;
  order: Order;
}

const openBills: OpenBill[] = restaurantTables.flatMap((table) => {
  const order = orders.find((candidate) => candidate.tableId === table.id);
  return order && typeof table.total === "number" ? [{ table, order }] : [];
});

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

function formatDate(date: Date | null) {
  if (!date) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function CashierDashboard() {
  const defaultBill = openBills.find((bill) => bill.table.status === "bill-requested") ?? openBills[0];
  const [selectedTableId, setSelectedTableId] = useState(defaultBill?.table.id ?? "");
  const [paidTableIds, setPaidTableIds] = useState<string[]>([]);
  const [methodsByTable, setMethodsByTable] = useState<Record<string, PaymentMethod>>({});
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedBill = openBills.find((bill) => bill.table.id === selectedTableId) ?? openBills[0];
  const selectedMethod = selectedBill ? methodsByTable[selectedBill.table.id] ?? "card" : "card";
  const selectedIsPaid = selectedBill ? paidTableIds.includes(selectedBill.table.id) : false;
  const visibleBills = useMemo(
    () => openBills.filter((bill) => !paidTableIds.includes(bill.table.id)),
    [paidTableIds],
  );

  const metrics = useMemo(() => {
    const unpaidBills = openBills.filter((bill) => !paidTableIds.includes(bill.table.id));
    const paidBills = openBills.filter((bill) => paidTableIds.includes(bill.table.id));
    const outstanding = unpaidBills.reduce((sum, bill) => sum + (bill.table.total ?? bill.order.total), 0);
    const collected = paidBills.reduce((sum, bill) => sum + (bill.table.total ?? bill.order.total), 0);
    const paymentWaiting = unpaidBills.filter((bill) => bill.table.status === "bill-requested").length;

    return {
      outstanding,
      collected,
      paymentWaiting,
      unpaidCount: unpaidBills.length,
      average: unpaidBills.length ? outstanding / unpaidBills.length : 0,
    };
  }, [paidTableIds]);

  const selectPaymentMethod = (method: PaymentMethod) => {
    if (!selectedBill || selectedIsPaid) return;
    setMethodsByTable((current) => ({ ...current, [selectedBill.table.id]: method }));
  };

  const takePayment = () => {
    if (!selectedBill || selectedIsPaid) return;

    setPaidTableIds((current) => [...current, selectedBill.table.id]);
    toast.success(`${selectedBill.table.name} ödemesi alındı`, {
      description: `${formatCurrency(selectedBill.table.total ?? selectedBill.order.total)} tahsil edildi.`,
    });
  };

  if (!selectedBill) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <CircleCheckBig className="mx-auto size-10 text-olive" aria-hidden="true" />
          <h1 className="mt-4 font-heading text-2xl font-semibold">Açık hesap bulunmuyor</h1>
          <p className="mt-2 text-sm text-muted-foreground">Yeni bir masa hesabı açıldığında burada görünecek.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <header className="border-b border-white/10 bg-olive text-[#FFFDF8]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark compact className="size-11 shrink-0 border-gold/35" />
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Kasa Paneli</h1>
                <Badge className="hidden border border-gold/30 bg-gold/10 text-[#F7E5C2] sm:inline-flex">
                  Vardiya açık
                </Badge>
              </div>
              <p className="mt-1 truncate text-sm text-[#F5EBDD]/65">Hesap ve ödeme yönetimi</p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="hidden text-xs font-medium capitalize text-[#F5EBDD]/60 sm:block">{formatDate(now)}</p>
            <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight" suppressHydrationWarning>
              {formatClock(now)}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Kasa özeti">
          <StatCard
            label="Açık hesap"
            value={formatCurrency(metrics.outstanding)}
            helper={`${metrics.unpaidCount} masada bekliyor`}
            icon={WalletCards}
            tone="alert"
          />
          <StatCard
            label="Ödeme bekleyen"
            value={String(metrics.paymentWaiting)}
            helper="Hesap isteyen masalar"
            icon={ReceiptText}
          />
          <StatCard
            label="Bugün tahsilat"
            value={formatCurrency(18_460 + metrics.collected)}
            helper="Örnek vardiya toplamı"
            icon={CircleDollarSign}
            tone="success"
          />
          <StatCard
            label="Ortalama hesap"
            value={formatCurrency(metrics.average)}
            helper="Açık masalar üzerinden"
            icon={TrendingUp}
          />
        </section>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)] xl:gap-6">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Açık masalar</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Detay görmek için masa seçin</p>
                </div>
                <Badge variant="outline" className="border-olive/20 bg-olive/[0.06] text-olive">
                  {metrics.unpaidCount} hesap
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-2.5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Açık masa hesapları">
                {visibleBills.length ? visibleBills.map(({ table, order }) => {
                  const isSelected = table.id === selectedBill.table.id;
                  const isPaid = paidTableIds.includes(table.id);

                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => setSelectedTableId(table.id)}
                      aria-pressed={isSelected}
                      className={cn(
                        "min-h-24 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-burgundy/35 bg-burgundy/[0.055] shadow-[inset_3px_0_0_#681F25]"
                          : "border-transparent bg-muted/45 hover:border-border hover:bg-muted/70",
                      )}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block font-heading text-lg font-semibold leading-5 text-foreground">{table.name}</span>
                          <span className="mt-1.5 block text-xs font-medium text-muted-foreground">
                            {order.orderNumber} · {table.activeMinutes ?? order.elapsedMinutes} dk açık
                          </span>
                        </span>
                        <span className="text-base font-extrabold tabular-nums text-foreground">
                          {formatCurrency(table.total ?? order.total)}
                        </span>
                      </span>
                      <span className="mt-3 flex items-center justify-between gap-2">
                        {isPaid ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                            <Check className="size-3" aria-hidden="true" /> Ödendi
                          </Badge>
                        ) : (
                          <StatusBadge status={table.status} />
                        )}
                        <span className="text-xs text-muted-foreground">{table.seats} kişilik</span>
                      </span>
                    </button>
                  );
                }) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
                    <CircleCheckBig className="mx-auto size-7 text-emerald-700" aria-hidden="true" />
                    <p className="mt-2 text-sm font-bold text-emerald-950">Tüm açık hesaplar kapandı</p>
                    <p className="mt-1 text-xs text-emerald-800">Yeni hesap talepleri burada görünecek.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <CardTitle className="text-2xl">{selectedBill.table.name}</CardTitle>
                    {selectedIsPaid ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                        Ödendi
                      </Badge>
                    ) : (
                      <StatusBadge status="pending" label="Ödeme Bekliyor" />
                    )}
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{selectedBill.order.orderNumber}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {selectedBill.table.activeMinutes ?? selectedBill.order.elapsedMinutes} dk
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersRound className="size-3.5" aria-hidden="true" />
                      {selectedBill.table.seats} kişilik
                    </span>
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-xs font-medium text-muted-foreground">Ödenecek toplam</p>
                  <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-burgundy">
                    {formatCurrency(selectedBill.table.total ?? selectedBill.order.total)}
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="border-b border-border px-4 py-4 sm:px-5">
                <h2 className="font-heading text-lg font-semibold">Sipariş kalemleri</h2>
                <Table className="mt-2 min-w-[34rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-0">Ürün</TableHead>
                      <TableHead className="w-20 text-center">Adet</TableHead>
                      <TableHead className="w-28 text-right">Birim</TableHead>
                      <TableHead className="w-28 pr-0 text-right">Tutar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedBill.order.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="pl-0 whitespace-normal">
                          <span className="font-semibold text-foreground">{item.productName}</span>
                          {item.note ? <span className="mt-0.5 block text-xs text-burgundy">Not: {item.note}</span> : null}
                        </TableCell>
                        <TableCell className="text-center font-bold tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="pr-0 text-right font-bold tabular-nums">
                          {formatCurrency(item.quantity * item.unitPrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="px-4 py-4 sm:px-5 sm:py-5">
                {selectedIsPaid ? (
                  <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-7 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-700 text-white">
                      <CircleCheckBig className="size-6" aria-hidden="true" />
                    </div>
                    <h2 className="mt-3 font-heading text-xl font-semibold text-emerald-950">Ödeme alındı</h2>
                    <p className="mt-1 max-w-sm text-sm leading-6 text-emerald-800">
                      {selectedBill.table.name} hesabı {selectedMethod === "cash" ? "nakit olarak" : selectedMethod === "card" ? "kartla" : "diğer yöntemle"} kapatıldı.
                    </p>
                  </div>
                ) : (
                  <div>
                    <fieldset>
                      <legend className="font-heading text-lg font-semibold">Ödeme yöntemi</legend>
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
                                "flex min-h-20 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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

                    <Button type="button" size="lg" className="mt-4 h-12 w-full bg-burgundy text-base font-bold text-primary-foreground hover:bg-burgundy/90" onClick={takePayment}>
                      <Check className="size-5" aria-hidden="true" />
                      {formatCurrency(selectedBill.table.total ?? selectedBill.order.total)} tahsil et
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
