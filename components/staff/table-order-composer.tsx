"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Search, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/client";
import { staffApi } from "@/lib/api/endpoints";
import { formatCurrency } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

interface ComposerProduct {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly categoryName: string;
  readonly isAvailable: boolean;
}

/**
 * Waiter-side order pad, used both to open a round and to append a later one.
 * It only ever sends product ids and quantities; the price, service charge, tax
 * and total are computed by the order transaction from locked product rows, so
 * nothing money-related is client controlled.
 */
export function TableOrderComposer({
  tableId,
  appendToOrderId,
  onCancel,
  onCreated,
}: {
  tableId: string;
  /** When set the pad appends to this running order instead of opening one. */
  appendToOrderId?: string;
  onCancel: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Held across retries so a failed-then-retried send can never double-charge.
  const idempotencyKeyRef = useRef<string | null>(null);

  const loadMenu = useCallback((signal: AbortSignal) => staffApi.menu(signal), []);
  const menu = useApiResource(loadMenu);

  const products = useMemo<readonly ComposerProduct[]>(() => {
    const categories = menu.data?.categories ?? [];
    return categories.flatMap((category) =>
      category.products.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        categoryName: category.name,
        isAvailable: product.isAvailable,
      })),
    );
  }, [menu.data]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");
    if (!term) return products;
    return products.filter(
      (product) =>
        product.name.toLocaleLowerCase("tr-TR").includes(term) ||
        product.categoryName.toLocaleLowerCase("tr-TR").includes(term),
    );
  }, [products, search]);

  const selected = useMemo(
    () => products.filter((product) => (quantities[product.id] ?? 0) > 0),
    [products, quantities],
  );

  const estimatedSubtotal = useMemo(
    () =>
      selected.reduce(
        (total, product) => total + Number(product.price) * (quantities[product.id] ?? 0),
        0,
      ),
    [quantities, selected],
  );

  function changeQuantity(productId: string, delta: number) {
    // A different cart is a different request, so the replay key is dropped.
    idempotencyKeyRef.current = null;
    setQuantities((current) => {
      const next = Math.min(99, Math.max(0, (current[productId] ?? 0) + delta));
      const updated = { ...current };
      if (next === 0) delete updated[productId];
      else updated[productId] = next;
      return updated;
    });
  }

  async function submit() {
    if (submitting || !selected.length) return;
    setSubmitting(true);
    idempotencyKeyRef.current ??= staffApi.newIdempotencyKey();
    const items = selected.map((product) => ({
      productId: product.id,
      quantity: quantities[product.id] ?? 1,
    }));
    try {
      if (appendToOrderId) {
        const added = await staffApi.addOrderItems(
          appendToOrderId,
          items,
          idempotencyKeyRef.current,
        );
        idempotencyKeyRef.current = null;
        await onCreated();
        toast.success(
          added.replayed
            ? `${added.orderNumber} zaten güncellenmişti.`
            : `${added.orderNumber} siparişine ${added.addedItems.length} kalem eklendi.`,
          { description: `Yeni toplam ${formatCurrency(Number(added.amounts.total))}` },
        );
        return;
      }

      const created = await staffApi.createOrder(
        { tableId, items, notes: note.trim() || undefined },
        idempotencyKeyRef.current,
      );
      idempotencyKeyRef.current = null;
      await onCreated();
      toast.success(
        created.replayed
          ? `${created.orderNumber} zaten oluşturulmuştu.`
          : `${created.orderNumber} oluşturuldu.`,
        { description: `Toplam ${formatCurrency(Number(created.total))}` },
      );
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Sipariş oluşturulamadı.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h4 className="font-heading text-base font-semibold">
          {appendToOrderId ? "Mevcut siparişe ekle" : "Yeni sipariş"}
        </h4>
        <Button
          type="button"
          variant="ghost"
          className="size-9 p-0"
          onClick={onCancel}
          aria-label="Sipariş eklemeyi iptal et"
        >
          <X className="size-4" strokeWidth={1.8} />
        </Button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.8}
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ürün ara"
            aria-label="Menüde ürün ara"
            className="min-h-11 pl-9"
          />
        </div>

        {menu.error && !menu.data ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">
            {menu.error.message}
          </p>
        ) : menu.loading ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground" aria-live="polite">
            Menü yükleniyor…
          </p>
        ) : visibleProducts.length ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Menü ürünleri">
            {visibleProducts.map((product) => {
              const quantity = quantities[product.id] ?? 0;
              return (
                <li
                  key={product.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5",
                    quantity > 0 && "bg-muted/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {product.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {product.categoryName} · {formatCurrency(Number(product.price))}
                      {product.isAvailable ? "" : " · tükendi"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="size-11 p-0"
                      disabled={quantity === 0}
                      onClick={() => changeQuantity(product.id, -1)}
                      aria-label={`${product.name} adedini azalt`}
                    >
                      <Minus className="size-4" strokeWidth={1.8} />
                    </Button>
                    <span
                      className="w-6 text-center text-sm font-bold tabular-nums"
                      aria-label={`${product.name} adedi`}
                    >
                      {quantity}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="size-11 p-0"
                      disabled={!product.isAvailable}
                      onClick={() => changeQuantity(product.id, 1)}
                      aria-label={`${product.name} adedini artır`}
                    >
                      <Plus className="size-4" strokeWidth={1.8} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Aramaya uygun ürün yok.
          </p>
        )}

        {appendToOrderId ? null : (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Sipariş notu (isteğe bağlı)"
            aria-label="Sipariş notu"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Ara toplam (tahmini)</p>
          <p className="font-bold tabular-nums">{formatCurrency(estimatedSubtotal)}</p>
        </div>
        <Button
          type="button"
          className="min-h-11"
          disabled={submitting || !selected.length}
          aria-busy={submitting}
          onClick={() => void submit()}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <Send className="size-4" strokeWidth={1.8} />
          )}
          {appendToOrderId ? "Siparişe Ekle" : "Siparişi Gönder"}
        </Button>
      </div>
    </div>
  );
}
