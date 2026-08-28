"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Eraser, Loader2, Merge } from "lucide-react";
import { toast } from "sonner";

import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";
import { staffApi } from "@/lib/api/endpoints";
import { canRoleRunTableOperation, type TableOperation } from "@/lib/domain/table-operations";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/types";

type PanelOperation = TableOperation | null;

const OPERATION_LABELS: Readonly<Record<TableOperation, string>> = {
  TRANSFER: "Masa Taşı",
  MERGE: "Masa Birleştir",
  RESET: "Masayı Sıfırla",
};

const OPERATION_HINTS: Readonly<Record<TableOperation, string>> = {
  TRANSFER: "Bu masadaki açık işlemleri boş bir masaya taşır.",
  MERGE: "Bu masadaki açık işlemleri dolu bir masanın altında toplar.",
  RESET: "Kapanmış masayı boşa alır. Açık hesap varsa reddedilir.",
};

/**
 * The riskier floor operations, kept off the main action grid so the table card
 * stays readable. Each one confirms before it sends.
 */
export function TableOperationsPanel({
  table,
  tables,
  onChanged,
}: {
  table: RestaurantTable;
  tables: readonly RestaurantTable[];
  onChanged: () => Promise<void> | void;
}) {
  const { role } = useStaffSession();
  const [open, setOpen] = useState<PanelOperation>(null);
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState<PanelOperation>(null);

  const targets = useMemo(
    () =>
      tables.filter(
        (candidate) => candidate.id !== table.id && candidate.status !== "inactive",
      ),
    [table.id, tables],
  );

  const available = useMemo(
    () =>
      (["TRANSFER", "MERGE", "RESET"] as const).filter((operation) =>
        canRoleRunTableOperation(role, operation),
      ),
    [role],
  );

  if (available.length === 0) return null;

  function close() {
    setOpen(null);
    setTargetId("");
  }

  async function run(operation: TableOperation, work: () => Promise<string>) {
    if (pending) return;
    setPending(operation);
    try {
      const message = await work();
      await onChanged();
      close();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setPending(null);
    }
  }

  function submit() {
    if (open === "RESET") {
      void run("RESET", async () => {
        await staffApi.resetTable(table.id);
        return `${table.name} sıfırlandı.`;
      });
      return;
    }
    if (!targetId || !open) return;
    const target = targets.find((candidate) => candidate.id === targetId);
    const operation = open;
    void run(operation, async () => {
      const result =
        operation === "TRANSFER"
          ? await staffApi.transferTable(table.id, targetId)
          : await staffApi.mergeTables(table.id, targetId);
      const moved = result.movedOrderIds.length;
      return operation === "TRANSFER"
        ? `${table.name} → ${target?.name ?? "hedef masa"} taşındı (${moved} sipariş).`
        : `${table.name}, ${target?.name ?? "hedef masa"} ile birleştirildi (${moved} sipariş).`;
    });
  }

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold">Diğer işlemler</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Masa taşıma, birleştirme ve sıfırlama.
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        {available.map((operation) => {
          const Icon =
            operation === "TRANSFER" ? ArrowRightLeft : operation === "MERGE" ? Merge : Eraser;
          const active = open === operation;
          return (
            <Button
              key={operation}
              type="button"
              variant={active ? "secondary" : "outline"}
              className="min-h-12 w-full justify-start whitespace-normal px-3 text-left leading-tight"
              aria-expanded={active}
              aria-label={`${OPERATION_LABELS[operation]}. ${OPERATION_HINTS[operation]}`}
              onClick={() => {
                setTargetId("");
                setOpen(active ? null : operation);
              }}
            >
              <Icon className="size-4" strokeWidth={1.8} />
              {OPERATION_LABELS[operation]}
            </Button>
          );
        })}
      </div>

      {open ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm leading-5 text-muted-foreground">{OPERATION_HINTS[open]}</p>

          {open === "RESET" ? null : (
            <div className="space-y-1.5">
              <label
                className="text-sm font-semibold text-foreground"
                htmlFor="table-operation-target"
              >
                Hedef masa
              </label>
              <select
                id="table-operation-target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className={cn(
                  "min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <option value="">Masa seçin</option>
                {targets.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.status === "available" ? " · boş" : " · dolu"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="min-h-11" onClick={close}>
              Vazgeç
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={Boolean(pending) || (open !== "RESET" && !targetId)}
              aria-busy={pending === open}
              onClick={submit}
            >
              {pending === open ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
              ) : null}
              {OPERATION_LABELS[open]}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
