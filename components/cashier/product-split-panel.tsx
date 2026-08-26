"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SplittableItem {
  readonly orderItemId: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly allocatedQuantity: number;
  readonly remainingQuantity: number;
}

export interface CheckDraftInput {
  readonly label?: string;
  readonly items: readonly { orderItemId: string; quantity: number }[];
}

interface Draft {
  label: string;
  /** orderItemId → quantity on this draft. */
  quantities: Record<string, number>;
}

function emptyDraft(index: number): Draft {
  return { label: `Hesap ${index}`, quantities: {} };
}

/**
 * Touch-first product/quantity splitting. No drag and drop: every portion is
 * moved with plus/minus, and the panel refuses to submit while any billable
 * portion is still unassigned — the same rule the server enforces.
 */
export function ProductSplitPanel({
  items,
  pending,
  onCancel,
  onSubmit,
}: {
  items: readonly SplittableItem[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (checks: readonly CheckDraftInput[]) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(1), emptyDraft(2)]);

  const assignable = useMemo(
    () => items.filter((item) => item.quantity > 0),
    [items],
  );

  const assignedFor = useMemo(() => {
    const totals = new Map<string, number>();
    for (const draft of drafts) {
      for (const [orderItemId, quantity] of Object.entries(draft.quantities)) {
        totals.set(orderItemId, (totals.get(orderItemId) ?? 0) + quantity);
      }
    }
    return totals;
  }, [drafts]);

  const unassigned = useMemo(
    () =>
      assignable
        .map((item) => ({
          item,
          left: item.remainingQuantity - (assignedFor.get(item.orderItemId) ?? 0),
        }))
        .filter((entry) => entry.left > 0),
    [assignable, assignedFor],
  );

  function change(draftIndex: number, item: SplittableItem, delta: number) {
    setDrafts((current) =>
      current.map((draft, index) => {
        if (index !== draftIndex) return draft;
        const now = draft.quantities[item.orderItemId] ?? 0;
        const takenElsewhere = (assignedFor.get(item.orderItemId) ?? 0) - now;
        const ceiling = item.remainingQuantity - takenElsewhere;
        const next = Math.min(Math.max(0, now + delta), Math.max(0, ceiling));
        const quantities = { ...draft.quantities };
        if (next === 0) delete quantities[item.orderItemId];
        else quantities[item.orderItemId] = next;
        return { ...draft, quantities };
      }),
    );
  }

  function draftTotal(draft: Draft): number {
    return Object.entries(draft.quantities).reduce((total, [orderItemId, quantity]) => {
      const item = assignable.find((candidate) => candidate.orderItemId === orderItemId);
      return total + (item ? Number(item.unitPrice) * quantity : 0);
    }, 0);
  }

  const previewTotal = drafts.reduce((total, draft) => total + draftTotal(draft), 0);
  const emptyDrafts = drafts.filter(
    (draft) => Object.keys(draft.quantities).length === 0,
  ).length;
  const blocked = pending || unassigned.length > 0 || emptyDrafts > 0 || drafts.length < 2;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Ürünlere göre böl</p>

      {drafts.map((draft, draftIndex) => (
        <div key={draftIndex} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={draft.label}
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((candidate, index) =>
                    index === draftIndex
                      ? { ...candidate, label: event.target.value }
                      : candidate,
                  ),
                )
              }
              maxLength={80}
              aria-label={`${draftIndex + 1}. hesabın adı`}
              className="min-h-11 flex-1"
            />
            {drafts.length > 2 ? (
              <Button
                type="button"
                variant="ghost"
                className="size-11 p-0 text-destructive"
                aria-label={`${draft.label} hesabını kaldır`}
                onClick={() =>
                  setDrafts((current) => current.filter((_item, index) => index !== draftIndex))
                }
              >
                <Trash2 className="size-4" strokeWidth={1.8} />
              </Button>
            ) : null}
          </div>

          <ul className="space-y-1.5">
            {assignable.map((item) => {
              const quantity = draft.quantities[item.orderItemId] ?? 0;
              const takenElsewhere = (assignedFor.get(item.orderItemId) ?? 0) - quantity;
              const ceiling = item.remainingQuantity - takenElsewhere;

              return (
                <li key={item.orderItemId} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.productName}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Sipariş {item.quantity} · Dağıtılan{" "}
                      {(assignedFor.get(item.orderItemId) ?? 0) + item.allocatedQuantity} · Kalan{" "}
                      {Math.max(0, ceiling - quantity)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 p-0"
                    disabled={quantity === 0}
                    aria-label={`${item.productName} adedini azalt`}
                    onClick={() => change(draftIndex, item, -1)}
                  >
                    −
                  </Button>
                  <span className="w-7 text-center text-sm font-bold tabular-nums">
                    {quantity}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 p-0"
                    disabled={quantity >= ceiling}
                    aria-label={`${item.productName} adedini artır`}
                    onClick={() => change(draftIndex, item, 1)}
                  >
                    +
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="text-right text-sm font-bold tabular-nums">
            {formatCurrency(draftTotal(draft))}
          </p>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={drafts.length >= 20}
        onClick={() => setDrafts((current) => [...current, emptyDraft(current.length + 1)])}
      >
        <Plus className="size-4" strokeWidth={1.8} />
        Yeni Hesap
      </Button>

      {unassigned.length > 0 ? (
        <p
          className={cn(
            "rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive",
          )}
          role="status"
        >
          Hesap bölme tamamlanamadı.{" "}
          {unassigned
            .map((entry) => `${entry.left} ${entry.item.productName}`)
            .join(", ")}{" "}
          henüz bir hesaba atanmadı.
        </p>
      ) : emptyDrafts > 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm font-medium text-muted-foreground" role="status">
          Boş hesap oluşturulamaz.
        </p>
      ) : (
        <dl className="space-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          {drafts.map((draft, index) => (
            <div key={index} className="flex justify-between">
              <dt>{draft.label}</dt>
              <dd className="tabular-nums">{formatCurrency(draftTotal(draft))}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1 font-bold">
            <dt>Toplam</dt>
            <dd className="tabular-nums">{formatCurrency(previewTotal)}</dd>
          </div>
        </dl>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={blocked}
          aria-busy={pending}
          onClick={() =>
            onSubmit(
              drafts.map((draft) => ({
                label: draft.label.trim() || undefined,
                items: Object.entries(draft.quantities).map(([orderItemId, quantity]) => ({
                  orderItemId,
                  quantity,
                })),
              })),
            )
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
          Hesapları Oluştur
        </Button>
      </div>
    </div>
  );
}
