"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, Printer, RefreshCw, Route, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiClientError } from "@/lib/api/client";
import { adminApi, printerApi } from "@/lib/api/endpoints";
import { displayLabel, printErrorLabel } from "@/lib/domain/display";
import { PRINT_DOCUMENT_TYPES, PRINTER_STATION_TYPES } from "@/lib/domain/print-document";
import { SUPPORTED_ENCODINGS } from "@/lib/domain/escpos";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

/**
 * Printer, agent, routing and queue administration.
 *
 * The only screen in the product that shows a raw agent token, and it shows it
 * once: the server stores a digest, so a lost token is rotated rather than
 * recovered. That is stated on the dialog rather than left to be discovered.
 */

const DOCUMENT_LABELS: Record<string, string> = {
  KITCHEN_ORDER: "Mutfak Siparişi",
  KITCHEN_CANCEL: "Mutfak İptali",
  CUSTOMER_BILL: "Adisyon",
  PAYMENT_RECEIPT: "Ödeme Bilgi Fişi",
  X_REPORT: "X Raporu",
  Z_REPORT: "Z Raporu",
  TEST_PRINT: "Test Yazdırma",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Bekliyor",
  PROCESSING: "Gönderiliyor",
  PRINTED: "Yazdırıldı",
  FAILED: "Başarısız",
  CANCELLED: "İptal",
};

const STATION_LABELS: Record<string, string> = {
  KITCHEN: "Mutfak",
  BAR: "Bar",
  RECEIPT: "Kasa",
  GENERAL: "Genel",
};

function message(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
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

export function PrintersManager() {
  const [busy, setBusy] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [issuedToken, setIssuedToken] = useState<{ name: string; token: string } | null>(null);
  const [printerDraft, setPrinterDraft] = useState({
    agentId: "",
    name: "",
    code: "",
    stationType: "KITCHEN",
    deviceKey: "",
    charactersPerLine: "48",
    encoding: "CP857",
  });
  const [routeDraft, setRouteDraft] = useState({
    documentType: "KITCHEN_ORDER",
    categoryId: "ALL",
    printerId: "",
  });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [reprintJob, setReprintJob] = useState<string | null>(null);
  const [reprintReason, setReprintReason] = useState("");

  const loadAgents = useCallback((signal: AbortSignal) => printerApi.listAgents(signal), []);
  const loadPrinters = useCallback((signal: AbortSignal) => printerApi.listPrinters(signal), []);
  const loadRoutes = useCallback((signal: AbortSignal) => printerApi.listRoutes(signal), []);
  const loadMenu = useCallback((signal: AbortSignal) => adminApi.menu(signal), []);

  const agents = useApiResource(loadAgents, { pollMs: 30_000 });
  const printers = useApiResource(loadPrinters);
  const routes = useApiResource(loadRoutes);
  const menu = useApiResource(loadMenu);

  const jobQuery = useMemo(() => {
    const search = new URLSearchParams({ page: "1", pageSize: "20" });
    if (statusFilter !== "ALL") search.set("status", statusFilter);
    return search.toString();
  }, [statusFilter]);
  const loadJobs = useCallback(
    (signal: AbortSignal) => printerApi.listJobs(jobQuery, signal),
    [jobQuery],
  );
  // Polled, not streamed: a print queue changes on the order of seconds.
  const jobs = useApiResource(loadJobs, { pollMs: 15_000 });

  async function act(work: () => Promise<unknown>, failure: string, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      toast.success(success);
      await Promise.all([agents.refetch(), printers.refetch(), routes.refetch(), jobs.refetch()]);
    } catch (error) {
      toast.error(message(error, failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yazıcılar"
        description="Yerel yazdırma agentları, yazıcılar, yönlendirme ve kuyruk."
      />

      {/* ------------------------------------------------------------ agents */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="size-4.5" aria-hidden="true" /> Agentlar
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Agent restoran içinde çalışır ve dışarı doğru bağlanır; yazıcı adresleri
            yerel yapılandırmada kalır.
          </p>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                async () => {
                  const created = await printerApi.createAgent({ name: agentName.trim() });
                  setAgentName("");
                  setIssuedToken({ name: created.agent.name, token: created.rawToken });
                },
                "Agent oluşturulamadı.",
                "Agent oluşturuldu",
              );
            }}
          >
            <div className="min-w-48 flex-1">
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="agent-name">
                Agent adı
              </label>
              <Input
                id="agent-name"
                className="mt-1 h-10"
                maxLength={80}
                value={agentName}
                placeholder="Salon Bilgisayarı"
                onChange={(event) => setAgentName(event.target.value)}
              />
            </div>
            <Button type="submit" className="h-10" disabled={busy || !agentName.trim()}>
              <Plus className="size-4" aria-hidden="true" /> Agent Ekle
            </Button>
          </form>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Agent</TableHead>
                  <TableHead className="w-32">Durum</TableHead>
                  <TableHead className="w-36">Son görülme</TableHead>
                  <TableHead className="w-24">Sürüm</TableHead>
                  <TableHead className="w-52 pr-0 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(agents.data?.agents ?? []).map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="pl-0 font-semibold">{agent.name}</TableCell>
                    <TableCell>
                      {agent.revokedAt ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          İptal edildi
                        </Badge>
                      ) : agent.presence === "ONLINE" ? (
                        <Badge className="border border-status-success/30 bg-status-success-tint text-status-success">
                          <Wifi className="size-3" aria-hidden="true" /> Çevrimiçi
                        </Badge>
                      ) : agent.presence === "OFFLINE" ? (
                        <Badge variant="outline" className="text-status-warning">
                          <WifiOff className="size-3" aria-hidden="true" /> Çevrimdışı
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Bilinmiyor
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{moment(agent.lastSeenAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {agent.softwareVersion ?? "—"}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              async () => {
                                const result = await printerApi.updateAgent(agent.id, {
                                  action: "ROTATE_TOKEN",
                                });
                                if (result.rawToken) {
                                  setIssuedToken({
                                    name: result.agent.name,
                                    token: result.rawToken,
                                  });
                                }
                              },
                              "Token yenilenemedi.",
                              "Yeni token oluşturuldu",
                            )
                          }
                        >
                          <RefreshCw className="size-3.5" aria-hidden="true" /> Token yenile
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || Boolean(agent.revokedAt)}
                          onClick={() =>
                            void act(
                              () => printerApi.updateAgent(agent.id, { action: "REVOKE" }),
                              "Agent iptal edilemedi.",
                              "Agent iptal edildi",
                            )
                          }
                        >
                          İptal et
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(agents.data?.agents.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                      {agents.loading ? "Yükleniyor…" : "Henüz agent tanımlanmamış."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- printers */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Printer className="size-4.5" aria-hidden="true" /> Yazıcılar
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <form
            className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                async () => {
                  await printerApi.createPrinter({
                    agentId: printerDraft.agentId,
                    name: printerDraft.name.trim(),
                    code: printerDraft.code.trim().toUpperCase(),
                    stationType: printerDraft.stationType,
                    deviceKey: printerDraft.deviceKey.trim().toLowerCase(),
                    charactersPerLine: Number(printerDraft.charactersPerLine),
                    encoding: printerDraft.encoding,
                  });
                  setPrinterDraft((current) => ({ ...current, name: "", code: "", deviceKey: "" }));
                },
                "Yazıcı eklenemedi.",
                "Yazıcı eklendi",
              );
            }}
          >
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Agent</label>
              <Select
                value={printerDraft.agentId}
                onValueChange={(value) =>
                  setPrinterDraft((current) => ({ ...current, agentId: value ?? "" }))
                }
              >
                <SelectTrigger className="mt-1 h-10 w-full">
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {(agents.data?.agents ?? []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Ad</label>
              <Input
                className="mt-1 h-10"
                value={printerDraft.name}
                placeholder="Mutfak"
                onChange={(event) =>
                  setPrinterDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Kod</label>
              <Input
                className="mt-1 h-10 uppercase"
                value={printerDraft.code}
                placeholder="MUTFAK"
                onChange={(event) =>
                  setPrinterDraft((current) => ({
                    ...current,
                    code: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">İstasyon</label>
              <Select
                value={printerDraft.stationType}
                onValueChange={(value) =>
                  setPrinterDraft((current) => ({ ...current, stationType: value ?? "KITCHEN" }))
                }
              >
                <SelectTrigger className="mt-1 h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINTER_STATION_TYPES.map((station) => (
                    <SelectItem key={station} value={station}>
                      {STATION_LABELS[station]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Cihaz anahtarı</label>
              <Input
                className="mt-1 h-10"
                value={printerDraft.deviceKey}
                placeholder="kitchen-main"
                onChange={(event) =>
                  setPrinterDraft((current) => ({ ...current, deviceKey: event.target.value }))
                }
              />
            </div>
            <Button
              type="submit"
              className="h-10"
              disabled={
                busy ||
                !printerDraft.agentId ||
                !printerDraft.name.trim() ||
                !printerDraft.code.trim() ||
                !printerDraft.deviceKey.trim()
              }
            >
              <Plus className="size-4" aria-hidden="true" /> Ekle
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Cihaz anahtarı yerel agent yapılandırmasında bir adrese eşlenir; IP adresi
            sunucuda tutulmaz.
          </p>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[46rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Yazıcı</TableHead>
                  <TableHead className="w-24">İstasyon</TableHead>
                  <TableHead className="w-36">Cihaz</TableHead>
                  <TableHead className="w-24">Satır</TableHead>
                  <TableHead className="w-24">Kodlama</TableHead>
                  <TableHead className="w-28">Durum</TableHead>
                  <TableHead className="w-44 pr-0 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(printers.data?.printers ?? []).map((printer) => (
                  <TableRow key={printer.id}>
                    <TableCell className="pl-0">
                      <span className="font-semibold">{printer.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{printer.agentName}</span>
                    </TableCell>
                    <TableCell>{STATION_LABELS[printer.stationType]}</TableCell>
                    <TableCell className="font-mono text-xs">{printer.deviceKey}</TableCell>
                    <TableCell className="tabular-nums">{printer.charactersPerLine}</TableCell>
                    <TableCell>{printer.encoding}</TableCell>
                    <TableCell>
                      {printer.isActive ? (
                        <Badge variant="outline">Aktif</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Kullanım dışı
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !printer.isActive}
                          onClick={() =>
                            void act(
                              () =>
                                printerApi.testPrint(printer.id),
                              "Test yazdırma gönderilemedi.",
                              "Test yazdırma kuyruğa alındı",
                            )
                          }
                        >
                          Test Yazdır
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                printerApi.updatePrinter(printer.id, {
                                  isActive: !printer.isActive,
                                }),
                              "Yazıcı güncellenemedi.",
                              printer.isActive ? "Yazıcı kapatıldı" : "Yazıcı açıldı",
                            )
                          }
                        >
                          {printer.isActive ? "Kapat" : "Aç"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(printers.data?.printers.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      {printers.loading ? "Yükleniyor…" : "Henüz yazıcı tanımlanmamış."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ routing */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Route className="size-4.5" aria-hidden="true" /> Yönlendirme
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <form
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () =>
                  printerApi.createRoute({
                    documentType: routeDraft.documentType,
                    categoryId: routeDraft.categoryId === "ALL" ? null : routeDraft.categoryId,
                    printerId: routeDraft.printerId,
                    copies: 1,
                  }),
                "Yönlendirme eklenemedi.",
                "Yönlendirme eklendi",
              );
            }}
          >
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Belge</label>
              <Select
                value={routeDraft.documentType}
                onValueChange={(value) =>
                  setRouteDraft((current) => ({ ...current, documentType: value ?? "" }))
                }
              >
                <SelectTrigger className="mt-1 h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINT_DOCUMENT_TYPES.filter((type) => type !== "TEST_PRINT").map((type) => (
                    <SelectItem key={type} value={type}>
                      {DOCUMENT_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Kategori</label>
              <Select
                value={routeDraft.categoryId}
                onValueChange={(value) =>
                  setRouteDraft((current) => ({ ...current, categoryId: value ?? "ALL" }))
                }
              >
                <SelectTrigger className="mt-1 h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Varsayılan (tümü)</SelectItem>
                  {(menu.data?.categories ?? []).map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Yazıcı</label>
              <Select
                value={routeDraft.printerId}
                onValueChange={(value) =>
                  setRouteDraft((current) => ({ ...current, printerId: value ?? "" }))
                }
              >
                <SelectTrigger className="mt-1 h-10 w-full">
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {(printers.data?.printers ?? []).map((printer) => (
                    <SelectItem key={printer.id} value={printer.id}>
                      {printer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-10" disabled={busy || !routeDraft.printerId}>
              <Plus className="size-4" aria-hidden="true" /> Ekle
            </Button>
          </form>

          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Belge</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Yazıcı</TableHead>
                  <TableHead className="w-28 pr-0 text-right">Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(routes.data?.routes ?? []).map((route) => (
                  <TableRow key={route.id}>
                    <TableCell className="pl-0 font-semibold">
                      {displayLabel(DOCUMENT_LABELS, route.documentType, "Belge")}
                    </TableCell>
                    <TableCell>
                      {route.categoryId
                        ? (menu.data?.categories ?? []).find(
                            (category) => category.id === route.categoryId,
                          )?.name ?? "—"
                        : "Varsayılan"}
                    </TableCell>
                    <TableCell>{route.printerName}</TableCell>
                    <TableCell className="pr-0 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              printerApi.updateRoute(route.id, { isActive: !route.isActive }),
                            "Yönlendirme güncellenemedi.",
                            route.isActive ? "Yönlendirme kapatıldı" : "Yönlendirme açıldı",
                          )
                        }
                      >
                        {route.isActive ? "Aktif" : "Kapalı"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(routes.data?.routes.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      Yönlendirme tanımlanmamış; mutfak fişleri kuyruğa alınmaz.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------- queue */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">Yazdırma Kuyruğu</CardTitle>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "ALL")}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tümü</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <div className="overflow-x-auto">
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Belge</TableHead>
                  <TableHead>Yazıcı</TableHead>
                  <TableHead className="w-28">Durum</TableHead>
                  <TableHead className="w-20 text-center">Deneme</TableHead>
                  <TableHead className="w-36">Oluşturma</TableHead>
                  <TableHead className="w-56 pr-0 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobs.data?.rows ?? []).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="pl-0">
                      <span className="font-semibold">
                        {displayLabel(DOCUMENT_LABELS, job.documentType, "Belge")}
                      </span>
                      {job.reprintOfJobId ? (
                        <span className="ml-2 text-xs text-status-warning">
                          Yeniden yazdırma{job.reprintReason ? ` · ${job.reprintReason}` : ""}
                        </span>
                      ) : null}
                      {job.lastErrorSummary ? (
                        <span className="mt-0.5 block text-xs text-burgundy">
                          {printErrorLabel(job.lastErrorCode)}: {job.lastErrorSummary}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{job.printerName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          job.status === "PRINTED" && "border-status-success/30 bg-status-success-tint text-status-success",
                          job.status === "FAILED" && "border-burgundy/30 text-burgundy",
                        )}
                      >
                        {displayLabel(STATUS_LABELS, job.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{job.attemptCount}</TableCell>
                    <TableCell className="tabular-nums">{moment(job.createdAt)}</TableCell>
                    <TableCell className="pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || job.status !== "FAILED"}
                          onClick={() =>
                            void act(
                              () => printerApi.retryJob(job.id),
                              "Tekrar denenemedi.",
                              "Yeniden kuyruğa alındı",
                            )
                          }
                        >
                          Tekrar Dene
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setReprintJob(job.id);
                            setReprintReason("");
                          }}
                        >
                          Yeniden Yazdır
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(jobs.data?.rows.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      {jobs.loading ? "Yükleniyor…" : "Kuyrukta iş yok."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Toplam {jobs.data?.total ?? 0} kayıt. &quot;Yazdırıldı&quot;, baytların yazıcıya
            iletildiği anlamına gelir; kâğıdın fiziksel olarak çıktığını garanti etmez.
          </p>
        </CardContent>
      </Card>

      {/* The raw token is visible exactly once. */}
      <Dialog open={issuedToken !== null} onOpenChange={() => setIssuedToken(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agent Token</DialogTitle>
            <DialogDescription>
              Bu token yalnızca şimdi gösterilir. Sunucuda yalnız özeti saklanır; kaybolursa
              kurtarılamaz, yenilenir.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-semibold">{issuedToken?.name}</p>
          <code className="block break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
            {issuedToken?.token}
          </code>
          <p className="text-xs text-muted-foreground">
            Agent makinesinde <code>PRINTER_AGENT_TOKEN</code> ortam değişkenine yazın.
            Yapılandırma dosyasına yazmayın.
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setIssuedToken(null)}>
              Kaydettim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A reprint always says why. */}
      <Dialog open={reprintJob !== null} onOpenChange={() => setReprintJob(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yeniden Yazdır</DialogTitle>
            <DialogDescription>
              Özgün belge yeniden basılır ve &quot;yeniden yazdırma&quot; olarak işaretlenir.
              Kayıt üzerine yazılmaz.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={2}
            maxLength={300}
            value={reprintReason}
            placeholder="Örn. fiş yırtıldı"
            onChange={(event) => setReprintReason(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReprintJob(null)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={busy || reprintReason.trim().length === 0}
              onClick={() => {
                const jobId = reprintJob;
                if (!jobId) return;
                void act(
                  async () => {
                    await printerApi.reprintJob(jobId, reprintReason.trim());
                    setReprintJob(null);
                  },
                  "Yeniden yazdırılamadı.",
                  "Yeniden yazdırma kuyruğa alındı",
                );
              }}
            >
              Yazdır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        Desteklenen kodlamalar: {SUPPORTED_ENCODINGS.join(", ")}. Yazıcı çevrimdışı olsa bile
        sipariş, ödeme ve vardiya işlemleri kesintisiz devam eder.
      </p>
    </div>
  );
}
