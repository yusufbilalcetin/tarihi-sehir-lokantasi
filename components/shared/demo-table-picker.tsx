"use client";

import { useCallback, useState } from "react";
import { ArrowRight, Loader2, ScanLine } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";
import { demoApi, type DemoTableRow } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { TABLE_STATUS_LABELS, displayLabel } from "@/lib/domain/display";
import type { TableStatus } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

/**
 * The prototype's way in without a phone camera.
 *
 * It lists whatever active tables the restaurant actually has — no count and no
 * table is written into this file — and opening one goes through the ordinary
 * QR flow, so the guest session it produces is the same session a scanned code
 * produces.
 */

/**
 * Colour only. The words come from the shared vocabulary, which covers every
 * value the column can hold — this file used to keep its own list, and the
 * three statuses it had never heard of (ORDERING, DINING, CLEANING) reached
 * the screen as raw enum names.
 */
const STATUS_TONE: Readonly<Record<TableStatus, { dot: string; text: string }>> = {
  AVAILABLE: { dot: "bg-status-success", text: "text-status-success" },
  OCCUPIED: { dot: "bg-order-settled", text: "text-order-settled" },
  ORDERING: { dot: "bg-order-new", text: "text-order-new" },
  WAITING: { dot: "bg-order-new", text: "text-order-new" },
  DINING: { dot: "bg-order-served", text: "text-order-served" },
  WAITER_CALL: { dot: "bg-status-danger", text: "text-status-danger" },
  BILL_REQUESTED: { dot: "bg-status-warning", text: "text-status-warning" },
  CLEANING: { dot: "bg-status-info", text: "text-status-info" },
  INACTIVE: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

const NEUTRAL_TONE = { dot: "bg-muted-foreground", text: "text-muted-foreground" } as const;

function statusOf(status: string) {
  const known = (TABLE_STATUS_LABELS as Record<string, string | undefined>)[status];
  return {
    // `displayLabel` returns the em dash rather than the stored value, so a
    // status added to the database tomorrow shows as unknown, never as itself.
    label: known ?? displayLabel(TABLE_STATUS_LABELS, null),
    ...(STATUS_TONE[status as TableStatus] ?? NEUTRAL_TONE),
  };
}

/**
 * Whether trying again could possibly help.
 *
 * The launcher fails in two very different ways. A 4xx means the deployment is
 * telling us something it already knows and will keep knowing — the launcher
 * is switched off, or it cannot tell which restaurant to demo. A button that
 * re-asks the same question forever is worse than no button: it hides an
 * answer the server already gave. Anything else — a dropped connection, a
 * 500 — is worth one more try.
 *
 * The server's own words for that permanent answer name environment variables
 * and staff roles. They go to the console the developer who can act on them is
 * looking at, never onto a screen a guest may be looking at.
 */
function diagnose(
  error: unknown,
  transient: string,
): { readonly message: string; readonly retryable: boolean } {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    console.warn("[demo-table-picker]", error.status, error.message);
    return { message: "Demo masa seçimi şu anda kullanılamıyor.", retryable: false };
  }
  return { message: transient, retryable: true };
}

export function DemoTablePicker({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const load = useCallback((signal: AbortSignal) => demoApi.tables(signal), []);
  const resource = useApiResource(load, { enabled: open });
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const tables = resource.data?.tables ?? [];

  function openTable(table: DemoTableRow) {
    if (opening) return;
    setOpening(table.id);
    setFailure(null);
    demoApi
      .tableMenu(table.id)
      .then((result) => {
        // A real `/menu/<token>` URL: the gate validates it like any other.
        window.open(result.path, "_blank", "noopener,noreferrer");
        onOpenChange(false);
      })
      .catch((error: unknown) =>
        setFailure(diagnose(error, "Masa menüsü açılamadı. Tekrar deneyin.").message),
      )
      .finally(() => setOpening(null));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ScanLine className="size-5 text-burgundy" aria-hidden="true" /> Masa Seçin
          </DialogTitle>
          <DialogDescription>
            QR menüyü görüntülemek istediğiniz masayı seçin. Bu bir demo masa seçimidir;
            gerçek müşteri masadaki QR kodu okutur.
          </DialogDescription>
        </DialogHeader>

        {resource.loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-xl border border-border bg-muted/40"
              />
            ))}
          </div>
        ) : resource.error ? (
          (() => {
            const diagnosis = diagnose(resource.error, "Masalar yüklenemedi. Tekrar deneyin.");
            return (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center"
              >
                <p className="text-sm font-semibold text-destructive">{diagnosis.message}</p>
                {diagnosis.retryable ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 min-h-11"
                    disabled={resource.loading}
                    onClick={() => void resource.refetch()}
                  >
                    {resource.loading ? "Yükleniyor…" : "Yeniden dene"}
                  </Button>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bu bir kurulum ayarıdır; yeniden denemek sonucu değiştirmez.
                  </p>
                )}
              </div>
            );
          })()
        ) : tables.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Şu anda seçilebilir aktif masa bulunmuyor.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tables.map((table) => {
              const status = statusOf(table.status);
              const busy = opening === table.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  disabled={Boolean(opening)}
                  onClick={() => openTable(table)}
                  className={cn(
                    "group flex min-h-20 flex-col items-start justify-between rounded-xl border border-border bg-card p-3 text-left transition-colors",
                    "hover:border-burgundy/40 hover:bg-burgundy/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy",
                    busy && "opacity-70",
                    opening && !busy && "opacity-50",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="font-heading text-lg font-semibold">{table.name}</span>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin text-burgundy" aria-hidden="true" />
                    ) : (
                      <ArrowRight
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className={cn("flex items-center gap-1.5 text-xs font-medium", status.text)}>
                    <span className={cn("size-1.5 rounded-full", status.dot)} aria-hidden="true" />
                    {status.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {failure ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {failure}
          </p>
        ) : null}

        {tables.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {tables.length} aktif masa. Durum bilgisi yalnız bilgilendirmedir; her masanın
            menüsü açılabilir.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
