"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  History,
  LockKeyhole,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ShiftReportDialog } from "@/components/cashier/shift-report-dialog";
import { ApiClientError } from "@/lib/api/client";
import { cashierShiftApi } from "@/lib/api/endpoints";
import type { ShiftMoneySummary } from "@/lib/domain/cashier-shift";
import { formatCurrency } from "@/lib/format";
import type { CurrentShiftResult } from "@/lib/services/cashier-shift-service";
import { cn } from "@/lib/utils";

/**
 * The till's own screen: opening float, the live drawer position, cash in and
 * out, and the count-and-close flow.
 *
 * Every figure shown here is server-derived. The only number the cashier types
 * is the physical count, and even the resulting variance comes back from the
 * server rather than being computed in the browser.
 */

interface ShiftPanelProps {
  readonly state: CurrentShiftResult;
  readonly onChanged: () => Promise<void> | void;
}

function money(value: string): string {
  return formatCurrency(Number(value));
}

function clock(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

/** A plain decimal, so exact money never passes through a float. */
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/;

function normalizeMoney(value: string): string | null {
  const trimmed = value.trim().replace(",", ".");
  return MONEY_PATTERN.test(trimmed) ? Number(trimmed).toFixed(2) : null;
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "positive" && "text-status-success",
          tone === "negative" && "text-burgundy",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function ShiftPanel({ state, onChanged }: ShiftPanelProps) {
  const [busy, setBusy] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState<"CASH_IN" | "CASH_OUT">("CASH_IN");
  const [closeOpen, setCloseOpen] = useState(false);
  // The report the operator is looking at: the live X of the open drawer, or
  // the Z of the drawer they have just closed.
  const [reportShift, setReportShift] = useState<{ id: string; kind: "X" | "Z" } | null>(null);

  const shift = state.shift;
  const summary = state.summary;

  /**
   * One guard for every mutation: a second click while a request is in flight
   * does nothing. The backend's own concurrency rules are the real protection;
   * this only stops the obvious double submit.
   */
  const submit = useCallback(
    async (work: () => Promise<unknown>, failure: string): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      try {
        await work();
        await onChanged();
        return true;
      } catch (error) {
        toast.error(errorMessage(error, failure));
        // A conflict means this screen was acting on a drawer state that has
        // already moved on — another till, another device, or a shift closed
        // in between. Re-reading it turns a dead end into the current truth.
        if (error instanceof ApiClientError && error.status === 409) {
          await onChanged();
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, onChanged],
  );

  if (!shift || !summary) {
    return (
      <>
        <ClosedTill registers={state.availableRegisters} busy={busy} submit={submit} />
        {/* The Z of the drawer just closed stays reachable for printing. */}
        <ShiftReportDialog
          open={reportShift !== null}
          shiftId={reportShift?.id ?? null}
          kind={reportShift?.kind ?? "Z"}
          onOpenChange={(next) => {
            if (!next) setReportShift(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <Card className="gap-0 border-olive/25 py-0">
        <CardHeader className="border-b bg-olive/[0.04] py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">{shift.register.name}</CardTitle>
                <Badge className="border border-status-success/30 bg-status-success-tint text-status-success">
                  Açık Vardiya
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {shift.openedBy.name ?? "Kasiyer"} · {clock(shift.openedAt)} · Açılış Nakdi{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {money(shift.openingCash)}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-muted-foreground">Beklenen Nakit</p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-olive">
                {money(summary.expectedCash)}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="grid gap-x-6 px-4 py-3 sm:grid-cols-2 sm:px-5">
            <div>
              <SummaryRow label="Nakit tahsilat" value={money(summary.payments.cash)} tone="positive" />
              <SummaryRow label="Kart tahsilat" value={money(summary.payments.card)} tone="muted" />
              {Number(summary.payments.other) > 0 ? (
                <SummaryRow label="Diğer tahsilat" value={money(summary.payments.other)} tone="muted" />
              ) : null}
              <SummaryRow label="Nakit girişi" value={money(summary.cashIn)} tone="positive" />
            </div>
            <div>
              <SummaryRow label="Nakit iade" value={money(summary.refunds.cash)} tone="negative" />
              <SummaryRow label="Kart iade" value={money(summary.refunds.card)} tone="muted" />
              <SummaryRow label="Nakit çıkışı" value={money(summary.cashOut)} tone="negative" />
              <SummaryRow label="Toplam tahsilat" value={money(summary.grossCollected)} />
            </div>
          </div>

          {state.movements.length > 0 ? (
            <div className="border-t px-4 py-3 sm:px-5">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <History className="size-3.5" aria-hidden="true" /> Kasa hareketleri
              </h3>
              <ul className="mt-2 space-y-1.5">
                {state.movements.map((movement) => (
                  <li key={movement.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{movement.reason}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {clock(new Date(movement.createdAt).toISOString())}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-bold tabular-nums",
                        movement.type === "CASH_IN" ? "text-status-success" : "text-burgundy",
                      )}
                    >
                      {movement.type === "CASH_IN" ? "+" : "−"}
                      {money(movement.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-2 border-t px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
            <Button
              type="button"
              variant="outline"
              className="h-12 font-semibold"
              onClick={() => setReportShift({ id: shift.id, kind: "X" })}
            >
              <FileText className="size-4" aria-hidden="true" /> X Raporu
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 font-semibold"
              disabled={busy}
              onClick={() => {
                setMovementType("CASH_IN");
                setMovementOpen(true);
              }}
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" /> Nakit Girişi
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 font-semibold"
              disabled={busy}
              onClick={() => {
                setMovementType("CASH_OUT");
                setMovementOpen(true);
              }}
            >
              <ArrowUpFromLine className="size-4" aria-hidden="true" /> Nakit Çıkışı
            </Button>
            <Button
              type="button"
              className="h-12 bg-burgundy font-semibold text-primary-foreground hover:bg-burgundy/90"
              disabled={busy}
              onClick={() => setCloseOpen(true)}
            >
              <LockKeyhole className="size-4" aria-hidden="true" /> Kasayı Kapat
            </Button>
          </div>
        </CardContent>
      </Card>

      <MovementDialog
        open={movementOpen}
        type={movementType}
        busy={busy}
        onOpenChange={setMovementOpen}
        onSubmit={async (amount, reason, note) => {
          const done = await submit(
            () => cashierShiftApi.recordMovement(shift.id, { type: movementType, amount, reason, note }),
            "Kasa hareketi kaydedilemedi.",
          );
          if (done) {
            setMovementOpen(false);
            toast.success(movementType === "CASH_IN" ? "Nakit girişi kaydedildi" : "Nakit çıkışı kaydedildi");
          }
        }}
      />

      <CloseShiftDialog
        open={closeOpen}
        busy={busy}
        summary={summary}
        onOpenChange={setCloseOpen}
        onSubmit={async (countedCash, note) => {
          const closedId = shift.id;
          const done = await submit(
            () => cashierShiftApi.close(closedId, { countedCash, note }),
            "Kasa kapatılamadı.",
          );
          if (done) {
            setCloseOpen(false);
            toast.success("Kasa kapatıldı");
            // The Z report is written by the close itself, so it is ready now.
            setReportShift({ id: closedId, kind: "Z" });
          }
        }}
      />

      <ShiftReportDialog
        open={reportShift !== null}
        shiftId={reportShift?.id ?? null}
        kind={reportShift?.kind ?? "X"}
        onOpenChange={(next) => {
          if (!next) setReportShift(null);
        }}
      />
    </>
  );
}

function ClosedTill({
  registers,
  busy,
  submit,
}: {
  registers: CurrentShiftResult["availableRegisters"];
  busy: boolean;
  submit: (work: () => Promise<unknown>, failure: string) => Promise<boolean>;
}) {
  const [registerId, setRegisterId] = useState<string>(registers[0]?.id ?? "");
  const [openingCash, setOpeningCash] = useState("0.00");
  const normalized = useMemo(() => normalizeMoney(openingCash), [openingCash]);

  return (
    <Card className="gap-0 border-burgundy/25 py-0">
      <CardHeader className="border-b bg-burgundy/[0.04] py-4">
        <div className="flex items-center gap-2.5">
          <Wallet className="size-5 text-burgundy" aria-hidden="true" />
          <CardTitle className="text-lg">Kasa Kapalı</CardTitle>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Tahsilat ve iade işlemleri için önce kasayı açmanız gerekir.
        </p>
      </CardHeader>
      <CardContent className="px-4 py-4 sm:px-5">
        {registers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tanımlı aktif kasa bulunmuyor. Yöneticinizden bir kasa tanımlamasını isteyin.
          </p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!normalized || !registerId) return;
              const done = await submit(
                () => cashierShiftApi.open({ cashRegisterId: registerId, openingCash: normalized }),
                "Kasa açılamadı.",
              );
              if (done) toast.success("Kasa açıldı");
            }}
          >
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="shift-register">
                Kasa
              </label>
              <Select
                value={registerId}
                onValueChange={(value) => setRegisterId(value ?? "")}
              >
                <SelectTrigger id="shift-register" className="mt-1 h-11 w-full">
                  <SelectValue placeholder="Kasa seçin" />
                </SelectTrigger>
                <SelectContent>
                  {registers.map((register) => (
                    <SelectItem key={register.id} value={register.id}>
                      {register.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="opening-cash">
                Açılış Nakdi
              </label>
              <Input
                id="opening-cash"
                inputMode="decimal"
                className="mt-1 h-11 text-right tabular-nums"
                value={openingCash}
                aria-invalid={normalized === null}
                onChange={(event) => setOpeningCash(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11 bg-olive font-bold text-[#FFFDF8] hover:bg-olive/90"
              disabled={busy || !normalized || !registerId}
              aria-busy={busy}
            >
              Kasayı Aç
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MovementDialog({
  open,
  type,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  type: "CASH_IN" | "CASH_OUT";
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (amount: string, reason: string, note?: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const normalized = normalizeMoney(amount);
  const valid = normalized !== null && Number(normalized) > 0 && reason.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setAmount("");
          setReason("");
          setNote("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === "CASH_IN" ? (
              <ArrowDownToLine className="size-5 text-status-success" aria-hidden="true" />
            ) : (
              <ArrowUpFromLine className="size-5 text-burgundy" aria-hidden="true" />
            )}
            {type === "CASH_IN" ? "Nakit Girişi" : "Nakit Çıkışı"}
          </DialogTitle>
          <DialogDescription>
            Kasa hareketleri sonradan düzeltilemez; hatalı bir kayıt için ters yönde yeni bir
            hareket girin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="movement-amount">
              Tutar
            </label>
            <Input
              id="movement-amount"
              inputMode="decimal"
              className="mt-1 h-11 text-right tabular-nums"
              value={amount}
              aria-invalid={amount.length > 0 && normalized === null}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="movement-reason">
              Gerekçe
            </label>
            <Input
              id="movement-reason"
              className="mt-1 h-11"
              maxLength={120}
              value={reason}
              placeholder={type === "CASH_IN" ? "Bozuk para takviyesi" : "Tedarikçi ödemesi"}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="movement-note">
              Not (isteğe bağlı)
            </label>
            <Textarea
              id="movement-note"
              className="mt-1"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={busy || !valid}
            aria-busy={busy}
            onClick={() => void onSubmit(normalized!, reason.trim(), note.trim() || undefined)}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  open,
  busy,
  summary,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  summary: ShiftMoneySummary;
  onOpenChange: (open: boolean) => void;
  onSubmit: (countedCash: string, note?: string) => Promise<void>;
}) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const normalized = normalizeMoney(counted);

  // Shown for orientation only; the authoritative variance comes back from the
  // server, which recomputes the expectation inside the closing transaction.
  const preview = normalized
    ? (Number(normalized) - Number(summary.expectedCash)).toFixed(2)
    : null;
  const balanced = preview !== null && Number(preview) === 0;
  const needsNote = preview !== null && !balanced;
  const ready = normalized !== null && (!needsNote || note.trim().length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCounted("");
          setNote("");
          setConfirming(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kasayı Kapat</DialogTitle>
          <DialogDescription>
            Çekmecedeki nakdi sayın ve girin. Beklenen tutar ve kasa farkı sunucu tarafından
            hesaplanır.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-muted/40 px-4 py-3">
          <SummaryRow label="Açılış nakdi" value={money(summary.openingCash)} />
          <SummaryRow label="Nakit tahsilat" value={money(summary.payments.cash)} tone="positive" />
          <SummaryRow label="Nakit iade" value={money(summary.refunds.cash)} tone="negative" />
          <SummaryRow label="Nakit girişi" value={money(summary.cashIn)} tone="positive" />
          <SummaryRow label="Nakit çıkışı" value={money(summary.cashOut)} tone="negative" />
          <div className="mt-1 flex items-baseline justify-between border-t pt-2">
            <span className="text-sm font-semibold">Beklenen Nakit</span>
            <span className="text-lg font-extrabold tabular-nums">{money(summary.expectedCash)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Kart tahsilatı ({money(summary.payments.card)}) çekmecedeki nakde dahil değildir.
          </p>
        </div>

        <div className="grid gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="counted-cash">
              Sayılan Nakit
            </label>
            <Input
              id="counted-cash"
              inputMode="decimal"
              className="mt-1 h-12 text-right text-lg font-bold tabular-nums"
              value={counted}
              aria-invalid={counted.length > 0 && normalized === null}
              onChange={(event) => {
                setCounted(event.target.value);
                setConfirming(false);
              }}
            />
          </div>

          {preview !== null ? (
            <div
              className={cn(
                "flex items-baseline justify-between rounded-lg px-3 py-2",
                balanced ? "bg-status-success-tint text-status-success" : "bg-status-warning-tint text-status-warning",
              )}
              aria-live="polite"
            >
              <span className="text-sm font-semibold">Kasa Farkı</span>
              <span className="text-lg font-extrabold tabular-nums">
                {Number(preview) > 0 ? "+" : ""}
                {money(preview)}
              </span>
            </div>
          ) : null}

          {needsNote ? (
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="close-note">
                Fark açıklaması (zorunlu)
              </label>
              <Textarea
                id="close-note"
                className="mt-1"
                rows={2}
                maxLength={500}
                value={note}
                placeholder="Örn. bozuk para eksik sayıldı"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          {confirming ? (
            <Button
              type="button"
              className="bg-burgundy text-primary-foreground hover:bg-burgundy/90"
              disabled={busy || !ready}
              aria-busy={busy}
              onClick={() => void onSubmit(normalized!, note.trim() || undefined)}
            >
              <LockKeyhole className="size-4" aria-hidden="true" /> Onaylıyorum, kapat
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              Devam
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
