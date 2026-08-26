"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import type { SplittableItem } from "@/components/cashier/product-split-panel";

export interface EditableCheck {
  readonly id: string;
  readonly label: string;
  readonly total: string;
  readonly items: readonly {
    readonly orderItemId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly unitPrice: string;
  }[];
}

export interface CheckEditSubmission {
  readonly label?: string;
  readonly allocations?: readonly { orderItemId: string; quantity: number }[];
}

/**
 * Edits one untouched check. An equal-split check carries an amount rather than
 * lines, so it is deliberately label-only here: turning it into an item check
 * would silently change what the guest was quoted.
 */
export function CheckEditPanel({
  check,
  items,
  pending,
  onCancel,
  onSubmit,
}: {
  check: EditableCheck;
  /** Every billable line on the order, with what is already allocated. */
  items: readonly SplittableItem[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (submission: CheckEditSubmission) => void;
}) {
  const allocationBased = check.items.length > 0;
  const [label, setLabel] = useState(check.label);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(check.items.map((item) => [item.orderItemId, item.quantity])),
  );

  /** How much of each line other live checks already hold. */
  const heldElsewhere = useMemo(() => {
    const held = new Map<string, number>();
    for (const item of items) {
      const mine = check.items.find(
        (allocation) => allocation.orderItemId === item.orderItemId,
      );
      held.set(item.orderItemId, item.allocatedQuantity - (mine?.quantity ?? 0));
    }
    return held;
  }, [check.items, items]);

  const previewTotal = useMemo(
    () =>
      Object.entries(quantities).reduce((total, [orderItemId, quantity]) => {
        const item = items.find((candidate) => candidate.orderItemId === orderItemId);
        return total + (item ? Number(item.unitPrice) * quantity : 0);
      }, 0),
    [items, quantities],
  );

  function change(item: SplittableItem, delta: number) {
    setQuantities((current) => {
      const ceiling = item.quantity - (heldElsewhere.get(item.orderItemId) ?? 0);
      const next = Math.min(
        Math.max(0, (current[item.orderItemId] ?? 0) + delta),
        Math.max(0, ceiling),
      );
      const updated = { ...current };
      if (next === 0) delete updated[item.orderItemId];
      else updated[item.orderItemId] = next;
      return updated;
    });
  }

  const labelValid = label.trim().length > 0 && label.trim().length <= 80;
  const allocationsValid = !allocationBased || Object.keys(quantities).length > 0;
  const blocked = pending || !labelValid || !allocationsValid;

  return (
    <div className="space-y-3 rounded-xl border border-burgundy/30 bg-burgundy/[0.04] p-4">
      <p className="text-sm font-semibold">{check.label} düzenleniyor</p>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold" htmlFor={`check-label-${check.id}`}>
          Hesap adı
        </label>
        <Input
          id={`check-label-${check.id}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          className="min-h-11"
        />
        {!labelValid ? (
          <p className="text-xs font-semibold text-destructive">Hesap adı boş olamaz.</p>
        ) : null}
      </div>

      {allocationBased ? (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const mine = quantities[item.orderItemId] ?? 0;
            const elsewhere = heldElsewhere.get(item.orderItemId) ?? 0;
            const ceiling = item.quantity - elsewhere;

            return (
              <li key={item.orderItemId} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.productName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Sipariş {item.quantity} · Diğer hesaplarda {elsewhere} · Bu hesapta {mine}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="size-11 p-0"
                  disabled={mine === 0}
                  aria-label={`${item.productName} adedini azalt`}
                  onClick={() => change(item, -1)}
                >
                  −
                </Button>
                <span className="w-7 text-center text-sm font-bold tabular-nums">{mine}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="size-11 p-0"
                  disabled={mine >= ceiling}
                  aria-label={`${item.productName} adedini artır`}
                  onClick={() => change(item, 1)}
                >
                  +
                </Button>
              </li>
            );
          })}
          {!allocationsValid ? (
            <li className="text-xs font-semibold text-destructive">
              Hesap en az bir kalem içermelidir.
            </li>
          ) : null}
        </ul>
      ) : (
        // Equal-split checks hold an amount, not lines.
        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          Bu hesap eşit bölme ile oluşturuldu; yalnız adı değiştirilebilir.
        </p>
      )}

      <dl className="flex justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
        <div>
          <dt className="text-muted-foreground">Önceki toplam</dt>
          <dd className="font-semibold tabular-nums">{formatCurrency(Number(check.total))}</dd>
        </div>
        {allocationBased ? (
          <div className="text-right">
            <dt className="text-muted-foreground">Yeni toplam (tahmini)</dt>
            <dd className="font-bold tabular-nums">{formatCurrency(previewTotal)}</dd>
          </div>
        ) : null}
      </dl>

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
            onSubmit({
              label: label.trim(),
              allocations: allocationBased
                ? Object.entries(quantities).map(([orderItemId, quantity]) => ({
                    orderItemId,
                    quantity,
                  }))
                : undefined,
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
          Kaydet
        </Button>
      </div>
    </div>
  );
}
