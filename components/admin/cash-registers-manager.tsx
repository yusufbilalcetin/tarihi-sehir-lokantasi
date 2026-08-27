"use client";

import { useCallback, useMemo, useState } from "react";
import { FileText, LockKeyhole, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ShiftReportDialog } from "@/components/cashier/shift-report-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiClientError } from "@/lib/api/client";
import { cashRegisterApi, cashierShiftApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Register master data and the restaurant's shift history in one place.
 *
 * History is paged by the server; this screen never asks for "everything".
 */

const PAGE_SIZE = 20;

function money(value: string | null): string {
  return value === null ? "—" : formatCurrency(Number(value));
}

function moment(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function CashRegistersManager() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");
  const [registerFilter, setRegisterFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [zShiftId, setZShiftId] = useState<string | null>(null);

  const loadRegisters = useCallback((signal: AbortSignal) => cashRegisterApi.list(signal), []);
  const registers = useApiResource(loadRegisters);
  /*
   * Base UI prints the selected value in the trigger unless the root is given
   * an item map, so these filters showed a database id once a real option was
   * chosen. The id stays the value; only the trigger's words come from here.
   */
  const registerFilterLabels = useMemo(
    () => ({
      ALL: "Tümü",
      ...Object.fromEntries((registers.data?.registers ?? []).map((r) => [r.id, r.name])),
    }),
    [registers.data],
  );
  const refetchRegisters = registers.refetch;

  const historyQuery = useMemo(() => {
    const search = new URLSearchParams();
    if (status !== "ALL") search.set("status", status);
    if (registerFilter !== "ALL") search.set("cashRegisterId", registerFilter);
    if (dateFrom) search.set("dateFrom", dateFrom);
    if (dateTo) search.set("dateTo", dateTo);
    search.set("page", String(page));
    search.set("pageSize", String(PAGE_SIZE));
    return search.toString();
  }, [dateFrom, dateTo, page, registerFilter, status]);

  const loadHistory = useCallback(
    (signal: AbortSignal) => cashierShiftApi.history(historyQuery, signal),
    [historyQuery],
  );
  const history = useApiResource(loadHistory);
  const refetchHistory = history.refetch;

  async function createRegister(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await cashRegisterApi.create({ name: name.trim(), code: code.trim().toUpperCase() });
      setName("");
      setCode("");
      await refetchRegisters();
      toast.success("Kasa tanımlandı");
    } catch (error) {
      toast.error(message(error, "Kasa tanımlanamadı."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRegister(registerId: string, isActive: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await cashRegisterApi.update(registerId, { isActive });
      await refetchRegisters();
      toast.success(isActive ? "Kasa etkinleştirildi" : "Kasa kullanım dışı bırakıldı");
    } catch (error) {
      toast.error(message(error, "Kasa güncellenemedi."));
    } finally {
      setBusy(false);
    }
  }

  const totalPages = history.data ? Math.max(1, Math.ceil(history.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kasa ve Vardiyalar"
        description="Kasa noktalarını tanımlayın ve vardiya geçmişini inceleyin."
      />

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="size-4.5" aria-hidden="true" /> Kasalar
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={createRegister}>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="register-name">
                Kasa adı
              </label>
              <Input
                id="register-name"
                className="mt-1 h-11"
                maxLength={80}
                value={name}
                placeholder="Ana Kasa"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="register-code">
                Kod
              </label>
              <Input
                id="register-code"
                className="mt-1 h-11 uppercase"
                maxLength={40}
                value={code}
                placeholder="ANA"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </div>
            <Button
              type="submit"
              className="h-11 font-semibold"
              disabled={busy || name.trim().length === 0 || code.trim().length === 0}
            >
              <Plus className="size-4" aria-hidden="true" /> Kasa Ekle
            </Button>
          </form>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Kasa</TableHead>
                  <TableHead className="w-28">Kod</TableHead>
                  <TableHead className="w-32">Durum</TableHead>
                  <TableHead className="w-40 pr-0 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(registers.data?.registers ?? []).map((register) => (
                  <TableRow key={register.id}>
                    <TableCell className="pl-0 font-semibold">{register.name}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{register.code}</TableCell>
                    <TableCell>
                      {register.hasOpenShift ? (
                        <Badge className="border border-status-success/30 bg-status-success-tint text-status-success">
                          Vardiya açık
                        </Badge>
                      ) : register.isActive ? (
                        <Badge variant="outline">Aktif</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Kullanım dışı
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        // A till being counted into cannot be taken out of
                        // service; the server refuses it too.
                        disabled={busy || register.hasOpenShift}
                        onClick={() => void toggleRegister(register.id, !register.isActive)}
                      >
                        {register.isActive ? "Kullanım dışı bırak" : "Etkinleştir"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(registers.data?.registers.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      {registers.loading ? "Yükleniyor…" : "Henüz kasa tanımlanmamış."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <LockKeyhole className="size-4.5" aria-hidden="true" /> Vardiya Geçmişi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="shift-status">
                Durum
              </label>
              <Select
                items={{ ALL: "Tümü", OPEN: "Açık", CLOSED: "Kapalı" }}
                value={status}
                onValueChange={(value) => {
                  setStatus(value as typeof status);
                  setPage(1);
                }}
              >
                <SelectTrigger id="shift-status" className="mt-1 h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tümü</SelectItem>
                  <SelectItem value="OPEN">Açık</SelectItem>
                  <SelectItem value="CLOSED">Kapalı</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="shift-register">
                Kasa
              </label>
              <Select
                items={registerFilterLabels}
                value={registerFilter}
                onValueChange={(value) => {
                  setRegisterFilter(value ?? "ALL");
                  setPage(1);
                }}
              >
                <SelectTrigger id="shift-register" className="mt-1 h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tümü</SelectItem>
                  {(registers.data?.registers ?? []).map((register) => (
                    <SelectItem key={register.id} value={register.id}>
                      {register.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="shift-from">
                Başlangıç
              </label>
              <Input
                id="shift-from"
                type="date"
                className="mt-1 h-10"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="shift-to">
                Bitiş
              </label>
              <Input
                id="shift-to"
                type="date"
                className="mt-1 h-10"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[52rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Kasa</TableHead>
                  <TableHead>Kasiyer</TableHead>
                  <TableHead className="w-32">Açılış</TableHead>
                  <TableHead className="w-32">Kapanış</TableHead>
                  <TableHead className="w-28 text-right">Beklenen</TableHead>
                  <TableHead className="w-28 text-right">Sayılan</TableHead>
                  <TableHead className="w-28 text-right">Kasa Farkı</TableHead>
                  <TableHead className="w-24 pr-0 text-right">Rapor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.rows ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-0 font-semibold">{row.registerNameSnapshot}</TableCell>
                    <TableCell>
                      {row.openedByName ?? "—"}
                      {row.closedByName && row.closedByName !== row.openedByName ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (kapatan: {row.closedByName})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{moment(row.openedAt.toString())}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.status === "OPEN" ? (
                        <Badge className="border border-status-success/30 bg-status-success-tint text-status-success">
                          Açık
                        </Badge>
                      ) : (
                        moment(row.closedAt ? row.closedAt.toString() : null)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(row.expectedCashAtClose)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(row.countedCashAtClose)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-bold tabular-nums",
                        row.cashVariance && Number(row.cashVariance) !== 0
                          ? "text-status-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {money(row.cashVariance)}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        // A Z report exists only for a shift closed since
                        // Phase 8B; older ones have none and none is invented.
                        disabled={row.status === "OPEN"}
                        onClick={() => setZShiftId(row.id)}
                      >
                        <FileText className="size-3.5" aria-hidden="true" /> Z
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(history.data?.rows.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      {history.loading ? "Yükleniyor…" : "Bu filtreye uyan vardiya yok."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Toplam {history.data?.total ?? 0} vardiya · sayfa {page}/{totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Önceki
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => {
                  setPage((current) => current + 1);
                  void refetchHistory();
                }}
              >
                Sonraki
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ShiftReportDialog
        open={zShiftId !== null}
        shiftId={zShiftId}
        kind="Z"
        onOpenChange={(next) => {
          if (!next) setZShiftId(null);
        }}
      />
    </div>
  );
}
