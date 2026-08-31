"use client";

import { useCallback, useMemo, useState } from "react";
import { Banknote, CreditCard, Loader2, Split, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/client";
import { PrintButton } from "@/components/shared/print-button";
import { CheckEditPanel } from "@/components/cashier/check-edit-panel";
import { ProductSplitPanel } from "@/components/cashier/product-split-panel";
import { checkApi, paymentApi } from "@/lib/api/endpoints";
import { playSound } from "@/lib/audio/sound-effects";
import {
  displayLabel,
  PAYMENT_METHOD_LABELS,
  paymentMethodLabel,
} from "@/lib/domain/display";
import { REFUND_REASON_CODES } from "@/lib/domain/financial-operations";
import { formatCurrency } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

type Method = "CASH" | "CARD" | "OTHER";
type Mode = "none" | "partial" | "split" | "refund";
type SplitMode = "equal" | "items";

const REFUND_REASON_LABELS: Readonly<Record<string, string>> = {
  CUSTOMER_COMPLAINT: "Müşteri şikâyeti",
  WRONG_CHARGE: "Yanlış tahsilat",
  QUALITY_ISSUE: "Ürün kalitesi",
  STAFF_ERROR: "Personel hatası",
  OVERPAYMENT: "Fazla tahsilat",
  OTHER: "Diğer",
};

export interface BillPaymentRow {
  readonly id: string;
  readonly amount: string;
  readonly refundedAmount: string;
  readonly method: Method;
  readonly at: string;
}

/**
 * Everything the counter needs beyond the one-tap collection: the money
 * position, split bills, part payments and refunds. Kept in a sheet so the
 * cashier's main screen stays a single fast path.
 */
export function BillOperationsSheet({
  open,
  orderId,
  orderNumber,
  tableName,
  orderTotal,
  payments,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  orderId: string;
  orderNumber: string;
  tableName: string;
  orderTotal: string;
  payments: readonly BillPaymentRow[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>("none");
  const [method, setMethod] = useState<Method>("CASH");
  const [amount, setAmount] = useState("");
  const [receivedCash, setReceivedCash] = useState("");
  const [shares, setShares] = useState(2);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [refundTarget, setRefundTarget] = useState<BillPaymentRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState<string>(REFUND_REASON_CODES[0]);
  const [refundNote, setRefundNote] = useState("");
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadChecks = useCallback(
    (signal: AbortSignal) => checkApi.list(orderId, signal),
    [orderId],
  );
  const checks = useApiResource(loadChecks, { enabled: open });
  const { refetch: refetchChecks } = checks;

  const ledger = useMemo(() => {
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const refunded = payments.reduce(
      (sum, payment) => sum + Number(payment.refundedAmount),
      0,
    );
    const net = paid - refunded;
    return {
      total: Number(orderTotal),
      paid,
      refunded,
      net,
      outstanding: Math.max(0, Number(orderTotal) - net),
    };
  }, [orderTotal, payments]);

  // Payments arrive oldest first, so the receipt defaults to the collection
  // that just happened — or to whichever one the cashier selected below.
  const receiptPaymentId =
    refundTarget?.id ?? payments.at(-1)?.id ?? null;

  const openChecks = (checks.data?.checks ?? []).filter(
    (check) => check.status !== "CANCELLED",
  );

  function reset() {
    setMode("none");
    setEditingCheckId(null);
    setAmount("");
    setReceivedCash("");
    setRefundTarget(null);
    setRefundAmount("");
    setRefundNote("");
  }

  async function run(work: () => Promise<string>) {
    if (pending) return;
    setPending(true);
    try {
      const message = await work();
      await onChanged();
      await refetchChecks();
      reset();
      toast.success(message);
    } catch (error) {
      void playSound("error");
      const apiError = error instanceof ApiClientError ? error : null;
      // Another till may have moved the bill under us. Never leave the panel
      // holding state the server has already rejected: reload and say so.
      const stale =
        apiError !== null &&
        ["CHECK_NOT_MUTABLE", "CHECK_ALREADY_PAID", "CHECK_NOT_FOUND", "CONFLICT"].includes(
          apiError.code,
        );
      if (stale) {
        setEditingCheckId(null);
        await refetchChecks();
        await onChanged();
      }
      toast.error(apiError?.message ?? "İşlem tamamlanamadı.", {
        description: stale ? "Güncel hali yeniden yüklendi." : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  function collect(checkId?: string, explicitAmount?: string) {
    void run(async () => {
      const payment = await paymentApi.collect(
        {
          orderId,
          method,
          amount: explicitAmount,
          checkId,
        },
        paymentApi.newIdempotencyKey(),
      );
      void playSound("payment-success");
      return `${formatCurrency(Number(payment.amount))} tahsil edildi.`;
    });
  }

  function submitRefund() {
    const target = refundTarget;
    if (!target || !refundAmount.trim()) return;
    const refundable = Number(target.amount) - Number(target.refundedAmount);
    if (
      !window.confirm(
        `${formatCurrency(Number(refundAmount))} iade edilecek. Onaylıyor musunuz?`,
      )
    ) {
      return;
    }
    if (Number(refundAmount) > refundable) {
      toast.error("İade tutarı iade edilebilir tutardan büyük olamaz.");
      return;
    }
    void run(async () => {
      const refund = await paymentApi.refund(
        target.id,
        {
          amount: refundAmount,
          reasonCode: refundReason,
          note: refundNote.trim() || undefined,
        },
        paymentApi.newIdempotencyKey(),
      );
      return `${formatCurrency(Number(refund.amount))} iade edildi.`;
    });
  }

  const change = Number(receivedCash) - Number(amount || ledger.outstanding);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : (reset(), onOpenChange(false)))}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-full gap-0 data-[side=right]:sm:max-w-lg"
      >
        <Button
          type="button"
          variant="ghost"
          className="absolute right-2 top-2 z-10 size-11 p-0"
          onClick={() => onOpenChange(false)}
          aria-label="Hesap işlemlerini kapat"
        >
          <X className="size-5" strokeWidth={1.8} />
        </Button>

        <SheetHeader className="border-b border-border bg-muted/35 px-5 py-5 pr-14">
          <SheetTitle className="text-2xl font-semibold tracking-tight">
            {tableName} · Hesap İşlemleri
          </SheetTitle>
          <SheetDescription>{orderNumber}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm">
            <dt className="text-muted-foreground">Toplam</dt>
            <dd className="text-right font-bold tabular-nums">{formatCurrency(ledger.total)}</dd>
            <dt className="text-muted-foreground">Tahsil edilen</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCurrency(ledger.paid)}</dd>
            <dt className="text-muted-foreground">İade</dt>
            <dd className="text-right font-semibold tabular-nums text-destructive">
              {formatCurrency(ledger.refunded)}
            </dd>
            <dt className="text-muted-foreground">Net tahsilat</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCurrency(ledger.net)}</dd>
            <dt className="font-semibold text-foreground">Kalan</dt>
            <dd className="text-right text-lg font-extrabold tabular-nums text-burgundy">
              {formatCurrency(ledger.outstanding)}
            </dd>
          </dl>

          <div className="grid grid-cols-2 gap-2.5">
            <PrintButton
              label="Adisyon Yazdır"
              className="min-h-12 whitespace-normal leading-tight"
              document={{ documentType: "CUSTOMER_BILL", orderId }}
            />
            {/* The receipt belongs to one collection, so it is the latest one
                unless the cashier picked another in the refund list. */}
            <PrintButton
              label="Ödeme Bilgi Fişi"
              className="min-h-12 whitespace-normal leading-tight"
              disabled={receiptPaymentId === null}
              document={{
                documentType: "PAYMENT_RECEIPT",
                paymentId: receiptPaymentId ?? "",
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Button
              type="button"
              variant={mode === "partial" ? "secondary" : "outline"}
              className="min-h-12 whitespace-normal leading-tight"
              onClick={() => setMode(mode === "partial" ? "none" : "partial")}
            >
              <Banknote className="size-4" strokeWidth={1.8} />
              Kısmi Ödeme
            </Button>
            <Button
              type="button"
              variant={mode === "split" ? "secondary" : "outline"}
              className="min-h-12 whitespace-normal leading-tight"
              onClick={() => setMode(mode === "split" ? "none" : "split")}
            >
              <Split className="size-4" strokeWidth={1.8} />
              Hesabı Böl
            </Button>
            <Button
              type="button"
              variant={mode === "refund" ? "secondary" : "outline"}
              className="min-h-12 whitespace-normal leading-tight"
              disabled={payments.length === 0}
              title={payments.length === 0 ? "Henüz tahsilat yok." : "Tahsilat iadesi"}
              onClick={() => setMode(mode === "refund" ? "none" : "refund")}
            >
              <Undo2 className="size-4" strokeWidth={1.8} />
              İade
            </Button>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold">Ödeme yöntemi</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(Object.keys(PAYMENT_METHOD_LABELS) as Method[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={method === option ? "default" : "outline"}
                  className="min-h-11"
                  aria-pressed={method === option}
                  onClick={() => setMethod(option)}
                >
                  {option === "CARD" ? (
                    <CreditCard className="size-4" strokeWidth={1.8} />
                  ) : (
                    <Banknote className="size-4" strokeWidth={1.8} />
                  )}
                  {PAYMENT_METHOD_LABELS[option]}
                </Button>
              ))}
            </div>
          </fieldset>

          {mode === "partial" ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="partial-amount">
                  Ödenecek tutar
                </label>
                <Input
                  id="partial-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={ledger.outstanding.toFixed(2)}
                  className="min-h-11"
                />
              </div>
              {method === "CASH" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold" htmlFor="received-cash">
                    Müşteriden alınan (opsiyonel)
                  </label>
                  <Input
                    id="received-cash"
                    inputMode="decimal"
                    value={receivedCash}
                    onChange={(event) => setReceivedCash(event.target.value)}
                    className="min-h-11"
                  />
                  {receivedCash && change > 0 ? (
                    // UI convenience only; the payment amount stays the bill.
                    <p className="text-sm font-semibold text-olive">
                      Para üstü {formatCurrency(change)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={pending || !amount.trim()}
                aria-busy={pending}
                onClick={() => collect(undefined, amount.trim())}
              >
                {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
                Tahsil Et
              </Button>
            </div>
          ) : null}

          {mode === "split" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={splitMode === "items" ? "default" : "outline"}
                  className="min-h-11"
                  aria-pressed={splitMode === "items"}
                  onClick={() => setSplitMode("items")}
                >
                  Ürünlere Göre
                </Button>
                <Button
                  type="button"
                  variant={splitMode === "equal" ? "default" : "outline"}
                  className="min-h-11"
                  aria-pressed={splitMode === "equal"}
                  onClick={() => setSplitMode("equal")}
                >
                  Eşit Böl
                </Button>
              </div>

              {splitMode === "items" ? (
                <ProductSplitPanel
                  items={checks.data?.allocatableItems ?? []}
                  pending={pending}
                  onCancel={() => setMode("none")}
                  onSubmit={(drafts) =>
                    void run(async () => {
                      const result = await checkApi.splitByItems(orderId, drafts);
                      return `${result.checks.length} hesaba bölündü.`;
                    })
                  }
                />
              ) : (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold">Hesabı eşit böl</p>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="size-11 p-0"
                  aria-label="Kişi sayısını azalt"
                  disabled={shares <= 2}
                  onClick={() => setShares((current) => Math.max(2, current - 1))}
                >
                  −
                </Button>
                <span className="w-10 text-center text-lg font-bold tabular-nums">{shares}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="size-11 p-0"
                  aria-label="Kişi sayısını artır"
                  disabled={shares >= 20}
                  onClick={() => setShares((current) => Math.min(20, current + 1))}
                >
                  +
                </Button>
                <Button
                  type="button"
                  className="ml-auto min-h-11"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() =>
                    void run(async () => {
                      const result = await checkApi.splitEqually(orderId, shares);
                      return `${result.checks.length} hesaba bölündü.`;
                    })
                  }
                >
                  Hesabı Böl
                </Button>
              </div>
            </div>
              )}
            </div>
          ) : null}

          {mode === "refund" ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
              <p className="text-sm font-semibold">İade edilecek tahsilat</p>
              <div className="space-y-2">
                {payments.map((payment) => {
                  const refundable = Number(payment.amount) - Number(payment.refundedAmount);
                  const active = refundTarget?.id === payment.id;
                  return (
                    <button
                      key={payment.id}
                      type="button"
                      aria-pressed={active}
                      disabled={refundable <= 0}
                      onClick={() => {
                        setRefundTarget(payment);
                        setRefundAmount(refundable.toFixed(2));
                      }}
                      className={cn(
                        "flex w-full min-h-12 items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm",
                        active ? "border-burgundy bg-burgundy/10" : "border-border bg-card",
                        refundable <= 0 && "opacity-50",
                      )}
                    >
                      <span className="font-semibold">
                        {paymentMethodLabel(payment.method)} · {payment.at}
                      </span>
                      <span className="tabular-nums">
                        {formatCurrency(Number(payment.amount))}
                        {Number(payment.refundedAmount) > 0 ? (
                          <span className="ml-1 text-xs text-destructive">
                            (−{formatCurrency(Number(payment.refundedAmount))})
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              {refundTarget ? (
                <>
                  <dl className="grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Orijinal ödeme</dt>
                    <dd className="text-right tabular-nums">
                      {formatCurrency(Number(refundTarget.amount))}
                    </dd>
                    <dt className="text-muted-foreground">Daha önce iade</dt>
                    <dd className="text-right tabular-nums">
                      {formatCurrency(Number(refundTarget.refundedAmount))}
                    </dd>
                    <dt className="font-semibold">İade edilebilir</dt>
                    <dd className="text-right font-bold tabular-nums">
                      {formatCurrency(
                        Number(refundTarget.amount) - Number(refundTarget.refundedAmount),
                      )}
                    </dd>
                  </dl>
                  <Input
                    inputMode="decimal"
                    value={refundAmount}
                    onChange={(event) => setRefundAmount(event.target.value)}
                    aria-label="İade tutarı"
                    className="min-h-11"
                  />
                  <div className="flex flex-wrap gap-2">
                    {REFUND_REASON_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={refundReason === code}
                        onClick={() => setRefundReason(code)}
                        className={cn(
                          "min-h-11 rounded-lg border px-3 text-sm font-semibold",
                          refundReason === code
                            ? "border-burgundy bg-burgundy text-primary-foreground"
                            : "border-border bg-card text-muted-foreground",
                        )}
                      >
                        {displayLabel(REFUND_REASON_LABELS, code, "Diğer")}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={refundNote}
                    onChange={(event) => setRefundNote(event.target.value)}
                    maxLength={300}
                    rows={2}
                    aria-label="İade açıklaması"
                    placeholder={refundReason === "OTHER" ? "Açıklama zorunlu" : "Açıklama"}
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11 w-full"
                    disabled={pending || !refundAmount.trim()}
                    aria-busy={pending}
                    onClick={submitRefund}
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
                    İadeyi Onayla
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          {openChecks.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="font-heading text-lg font-semibold">Bölünmüş hesaplar</h3>
                {openChecks.map((check) => (
                  <div
                    key={check.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{check.label}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatCurrency(Number(check.total))}
                        {check.status === "PAID"
                          ? " · ödendi"
                          : ` · kalan ${formatCurrency(Number(check.outstanding))}`}
                      </p>
                    </div>
                    {check.status === "OPEN" ? (
                      <div className="flex flex-wrap gap-2">
                        {/* Only a check that has taken no money may be changed. */}
                        {Number(check.paidTotal) === 0 ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-11"
                              disabled={pending}
                              aria-expanded={editingCheckId === check.id}
                              onClick={() =>
                                setEditingCheckId(
                                  editingCheckId === check.id ? null : check.id,
                                )
                              }
                            >
                              Düzenle
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-11 text-destructive"
                              disabled={pending}
                              onClick={() => {
                                if (!window.confirm(`${check.label} iptal edilsin mi?`)) return;
                                void run(async () => {
                                  await checkApi.cancel(orderId, check.id);
                                  return `${check.label} iptal edildi.`;
                                });
                              }}
                            >
                              İptal Et
                            </Button>
                          </>
                        ) : null}
                        <Button
                          type="button"
                          className="min-h-11"
                          disabled={pending}
                          aria-busy={pending}
                          onClick={() => collect(check.id)}
                        >
                          Tahsil Et
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm font-semibold text-olive">ÖDENDİ</span>
                    )}

                    {editingCheckId === check.id ? (
                      <div className="w-full">
                        <CheckEditPanel
                          check={check}
                          items={checks.data?.allocatableItems ?? []}
                          pending={pending}
                          onCancel={() => setEditingCheckId(null)}
                          onSubmit={(submission) =>
                            void run(async () => {
                              await checkApi.update(orderId, check.id, submission);
                              setEditingCheckId(null);
                              return `${check.label} güncellendi.`;
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
