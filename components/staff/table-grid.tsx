"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Ban,
  BellRing,
  Loader2,
  Plus,
  ReceiptText,
  StickyNote,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { CancellationReasonForm } from "@/components/staff/cancellation-reason-form";
import { TableOperationsPanel } from "@/components/staff/table-operations-panel";
import { TableOrderComposer } from "@/components/staff/table-order-composer";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toApiOrderItemStatus, toApiOrderStatus } from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { orderItemApi, staffApi, type StaffCallPayload } from "@/lib/api/endpoints";
import { displayLabel } from "@/lib/domain/display";
import {
  VOID_REASON_CODES,
  canRoleVoidItem,
  isItemVoidable,
} from "@/lib/domain/financial-operations";
import {
  canAddItemsToOrder,
  canRoleCancelOrder,
  canRoleCancelOrderItem,
  itemCancellationNeedsConfirmation,
} from "@/lib/domain/order-mutations";
import type { UserRole } from "@/lib/domain/status";
import {
  TABLE_NOTE_LABEL,
  resolveTableQuickActions,
  type TableQuickAction,
  type TableQuickActionId,
} from "@/lib/domain/table-actions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, RestaurantTable } from "@/types";

/**
 * One primary action, then five equals.
 *
 * "Sipariş Ekle" is what a waiter opens a table for; everything else is a
 * response to something that already happened. Confirming used to be styled as
 * a second filled button and competed with it for the eye at a glance.
 */
const tableActions = [
  { id: "add-order", label: "Sipariş Ekle", icon: Plus, variant: "default" as const },
  { id: "confirm-order", label: "Siparişi Onayla", icon: BadgeCheck, variant: "outline" as const },
  { id: "mark-served", label: "Servis Edildi", icon: Utensils, variant: "outline" as const },
  { id: "waiter-call", label: "Garson Talebi", icon: BellRing, variant: "outline" as const },
  { id: "bill-request", label: "Hesap", icon: ReceiptText, variant: "outline" as const },
  { id: "table-note", label: "Masa Notu", icon: StickyNote, variant: "outline" as const },
] as const satisfies readonly { id: TableQuickActionId; label: string; icon: unknown; variant: string }[];

/**
 * Actions that touch the same aggregate block each other while one is in
 * flight; independent ones stay tappable so the card is never fully locked.
 */
const ACTION_GROUPS: Readonly<Record<TableQuickActionId, string>> = {
  "add-order": "order-create",
  "confirm-order": "order-status",
  "mark-served": "order-status",
  "waiter-call": "call-waiter",
  "bill-request": "call-bill",
  "table-note": "call-note",
};

const VOID_REASON_LABELS: Readonly<Record<string, string>> = {
  CUSTOMER_COMPLAINT: "Müşteri şikâyeti",
  WRONG_ITEM: "Yanlış ürün",
  QUALITY_ISSUE: "Ürün kalitesi",
  STAFF_ERROR: "Personel hatası",
  MANAGER_COMP: "İkram",
  OTHER: "Diğer",
};

/** Used when a request carries no guest-picked label of its own. */
const CALL_FALLBACK_LABELS: Readonly<Record<StaffCallPayload["type"], string>> = {
  WAITER_CALL: "Garson çağır",
  BILL_REQUEST: "Hesap istiyor",
  OTHER: TABLE_NOTE_LABEL,
};

/** What each shortcut will actually do, announced to screen readers. */
function actionEffect(action: TableQuickAction): string {
  switch (action.intent.kind) {
    case "CREATE_ORDER":
      return "Bu masaya yeni sipariş açar.";
    case "ORDER_STATUS":
      return action.intent.nextStatus === "CONFIRMED"
        ? "Aktif siparişi onaylar."
        : "Aktif siparişi servis edildi olarak işaretler.";
    case "RESOLVE_CALL":
      return action.intent.callType === "OTHER"
        ? "Açık masa notunu kapatır."
        : "Açık talebi tamamlar.";
    default:
      return action.intent.callType === "BILL_REQUEST"
        ? "Bu masa için hesap talebi açar."
        : action.intent.callType === "OTHER"
          ? "Bu masaya not bırakır."
          : "Bu masa için garson talebi açar.";
  }
}

function TableOrderDetails({
  order,
  role,
  pendingItemId,
  onCancelItem,
  onVoidItem,
}: {
  order: Order;
  role: UserRole;
  pendingItemId: string | null;
  onCancelItem: (item: Order["items"][number]) => void;
  onVoidItem: (item: Order["items"][number]) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 bg-muted/55 px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Aktif sipariş</p>
          <p className="mt-0.5 font-bold text-foreground">{order.orderNumber}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="divide-y divide-border/70 px-4">
        {order.items.map((item) => {
          const itemStatus = toApiOrderItemStatus(item.status ?? "pending");
          const cancelled = itemStatus === "CANCELLED" || itemStatus === "VOIDED";
          const canCancel = !cancelled && canRoleCancelOrderItem(role, itemStatus);
          // A served line leaves the bill through a void, not a cancellation.
          const canVoid = !cancelled && isItemVoidable(itemStatus) && canRoleVoidItem(role);
          const busy = pendingItemId === item.id;

          return (
            <div key={item.id} className="flex gap-3 py-3">
              <span
                className={cn(
                  "min-w-8 font-bold tabular-nums",
                  cancelled ? "text-muted-foreground line-through" : "text-burgundy",
                )}
              >
                {item.quantity} ×
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-semibold",
                    cancelled ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {item.productName}
                </p>
                {item.note ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Not: {item.note}</p>
                ) : null}
                {cancelled ? (
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    {itemStatus === "VOIDED" ? "Hesaptan çıkarıldı" : "İptal edildi"}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    cancelled ? "text-muted-foreground line-through" : "text-muted-foreground",
                  )}
                >
                  {formatCurrency(item.quantity * item.unitPrice)}
                </span>
                {canCancel || canVoid ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs font-semibold text-destructive"
                    disabled={busy}
                    aria-busy={busy}
                    aria-label={
                      canVoid
                        ? `${item.productName} kalemini hesaptan çıkar`
                        : `${item.productName} kalemini iptal et`
                    }
                    onClick={() => (canVoid ? onVoidItem(item) : onCancelItem(item))}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <Ban className="size-3.5" strokeWidth={1.8} />
                    )}
                    {canVoid ? "Hesaptan Çıkar" : "İptal"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The parts a caller may arrange itself.
 *
 * `detailBody` is the selected table's order list, quick actions and composer —
 * the same node the sheet shows, so a cockpit column and a phone sheet can
 * never drift apart in what they let a waiter do.
 */
export interface TableGridLayoutParts {
  readonly detailBody: ReactNode;
  readonly selectedTable: RestaurantTable | null;
  readonly selectTable: (tableId: string | null) => void;
  readonly close: () => void;
}

export function TableGrid({
  tables,
  orders,
  calls,
  onChanged,
  renderLayout,
}: {
  tables: RestaurantTable[];
  orders: readonly Order[];
  calls: readonly StaffCallPayload[];
  onChanged: () => Promise<void> | void;
  /** The caller frames the parts; this component owns only the behaviour. */
  renderLayout: (parts: TableGridLayoutParts) => ReactNode;
}) {
  const { role } = useStaffSession();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TableQuickActionId | null>(null);
  const [composer, setComposer] = useState<"order" | "note" | null>(null);
  const [noteText, setNoteText] = useState("");
  const [cancelTarget, setCancelTarget] = useState<
    | { kind: "item"; item: Order["items"][number] }
    | { kind: "void"; item: Order["items"][number] }
    | { kind: "order" }
    | null
  >(null);
  const [cancelPending, setCancelPending] = useState(false);

  // Re-read from the refreshed list so the sheet follows server state instead
  // of a snapshot taken when the card was tapped.
  const selectedTable = selectedTableId
    ? tables.find((table) => table.id === selectedTableId) ?? null
    : null;

  // The server ranks the table's open order; the panel never guesses with [0].
  const selectedOrder = selectedTable?.orderId
    ? orders.find((order) => order.id === selectedTable.orderId)
    : undefined;

  const openCalls = useMemo(
    () =>
      calls.filter(
        (call) =>
          call.table.id === selectedTableId &&
          (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
      ),
    [calls, selectedTableId],
  );

  const quickActions = useMemo(
    () =>
      selectedTable
        ? resolveTableQuickActions({
            role,
            tableActive: selectedTable.status !== "inactive",
            order: selectedOrder
              ? { id: selectedOrder.id, status: toApiOrderStatus(selectedOrder.status) }
              : null,
            openCalls: openCalls.map((call) => ({ id: call.id, type: call.type })),
          })
        : [],
    [openCalls, role, selectedOrder, selectedTable],
  );

  function closeSheet() {
    setSelectedTableId(null);
    setComposer(null);
    setNoteText("");
    setCancelTarget(null);
  }

  /** A running order grows; a finished one gets a fresh round instead. */
  const appendToOrderId =
    selectedOrder && canAddItemsToOrder(toApiOrderStatus(selectedOrder.status))
      ? selectedOrder.id
      : undefined;

  function requestItemCancellation(item: Order["items"][number]) {
    const status = toApiOrderItemStatus(item.status ?? "pending");
    // A line the kitchen already touched is confirmed before it is dropped.
    if (
      itemCancellationNeedsConfirmation(status) &&
      !window.confirm(`${item.productName} hazırlanmış durumda. İptal edilsin mi?`)
    ) {
      return;
    }
    setCancelTarget({ kind: "item", item });
  }

  async function submitCancellation(submission: {
    reason: string;
    reasonNote?: string;
  }) {
    if (!cancelTarget || !selectedOrder || cancelPending) return;
    setCancelPending(true);
    try {
      if (cancelTarget.kind === "void") {
        const result = await orderItemApi.void(selectedOrder.id, cancelTarget.item.id, {
          reasonCode: submission.reason,
          note: submission.reasonNote,
        });
        await onChanged();
        toast.success(`${cancelTarget.item.productName} hesaptan çıkarıldı.`, {
          description: `Yeni toplam ${formatCurrency(Number(result.amounts.total))}`,
        });
      } else if (cancelTarget.kind === "item") {
        const result = await staffApi.cancelOrderItem(
          selectedOrder.id,
          cancelTarget.item.id,
          submission,
        );
        await onChanged();
        toast.success(`${cancelTarget.item.productName} iptal edildi.`, {
          description: `Yeni toplam ${formatCurrency(Number(result.amounts.total))}`,
        });
      } else {
        await staffApi.cancelOrder(selectedOrder.id, submission);
        await onChanged();
        toast.success(`${selectedOrder.orderNumber} iptal edildi.`);
      }
      setCancelTarget(null);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İptal tamamlanamadı.");
    } finally {
      setCancelPending(false);
    }
  }

  async function runAction(action: TableQuickAction, successMessage: string, work: () => Promise<void>) {
    if (pendingAction) return;
    setPendingAction(action.id);
    try {
      await work();
      await onChanged();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setPendingAction(null);
    }
  }

  function activate(action: TableQuickAction) {
    if (!selectedTable || !action.enabled) return;
    const tableName = selectedTable.name;
    const tableId = selectedTable.id;

    switch (action.intent.kind) {
      case "CREATE_ORDER":
        setComposer(composer === "order" ? null : "order");
        return;
      case "ORDER_STATUS": {
        const { orderId, nextStatus } = action.intent;
        void runAction(
          action,
          nextStatus === "CONFIRMED"
            ? `${tableName} siparişi onaylandı.`
            : `${tableName} siparişi servis edildi.`,
          async () => {
            await staffApi.updateOrderStatus(orderId, nextStatus);
          },
        );
        return;
      }
      case "RESOLVE_CALL": {
        const { callId, callType } = action.intent;
        void runAction(
          action,
          callType === "OTHER" ? `${tableName} notu kapatıldı.` : `${tableName} talebi tamamlandı.`,
          async () => {
            await staffApi.updateCall(callId, "RESOLVED");
          },
        );
        return;
      }
      default: {
        const { callType } = action.intent;
        if (callType === "OTHER") {
          setComposer(composer === "note" ? null : "note");
          return;
        }
        void runAction(
          action,
          callType === "BILL_REQUEST"
            ? `${tableName} için hesap talebi açıldı.`
            : `${tableName} için garson talebi açıldı.`,
          async () => {
            await staffApi.createCall({ tableId, type: callType });
          },
        );
      }
    }
  }

  function submitNote() {
    const action = quickActions.find((item) => item.id === "table-note");
    if (!action || !selectedTable || !noteText.trim()) return;
    const tableId = selectedTable.id;
    const text = noteText.trim();
    void runAction(action, `${selectedTable.name} notu kaydedildi.`, async () => {
      await staffApi.createCall({
        tableId,
        type: "OTHER",
        requestLabel: TABLE_NOTE_LABEL,
        notes: text,
      });
      setNoteText("");
      setComposer(null);
    });
  }

  // The scrollable body is plain markup on purpose: the sheet supplies its own
  // header and footer, and the cockpit renders this same node inline in its
  // right-hand column. One body, two frames — no second implementation of the
  // order list, the quick actions or the composer.
  const detailBody = selectedTable ? (
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
      {selectedOrder ? (
        <TableOrderDetails
          order={selectedOrder}
          role={role}
          pendingItemId={
            cancelPending && cancelTarget?.kind === "item"
              ? cancelTarget.item.id
              : null
          }
          onCancelItem={requestItemCancellation}
          onVoidItem={(item) => setCancelTarget({ kind: "void", item })}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center">
          <Utensils className="mx-auto size-6 text-muted-foreground" strokeWidth={1.6} />
          <p className="mt-3 font-semibold text-foreground">Aktif sipariş yok</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Bu masa için yeni sipariş ekleyebilirsiniz.
          </p>
        </div>
      )}

      {openCalls.length ? (
        <ul className="space-y-2" aria-label="Masanın açık talepleri">
          {openCalls.map((call) => (
            <li
              key={call.id}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm"
            >
              <BellRing
                className="mt-0.5 size-4 shrink-0 text-burgundy"
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {call.requestLabel ?? CALL_FALLBACK_LABELS[call.type]}
                </p>
                {call.notes ? (
                  <p className="mt-0.5 leading-5 text-muted-foreground">{call.notes}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-lg border border-gold/25 bg-sidebar p-4 text-card shadow-[var(--shadow-floating)]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-cream/65">Masa toplamı</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {formatCurrency(selectedTable.total ?? selectedOrder?.total ?? 0)}
            </p>
          </div>
          <p className="text-right text-xs leading-5 text-cream/60">
            Son hareket<br />{selectedTable.lastActivity}
          </p>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-heading text-lg font-semibold">Masa işlemleri</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Servis sırasında en sık kullanılan işlemler.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {tableActions.map((item) => {
            const Icon = item.icon;
            const action = quickActions.find((candidate) => candidate.id === item.id);
            if (!action) return null;
            const busy = pendingAction === item.id;
            const blocked =
              pendingAction !== null &&
              ACTION_GROUPS[pendingAction] === ACTION_GROUPS[item.id];
            const disabled = !action.enabled || blocked;

            const hint = action.disabledReason ?? actionEffect(action);

            return (
              // A disabled button drops pointer events, so the reason
              // lives on a wrapper that still has a hit area.
              <span key={item.id} className="block" title={hint}>
                <Button
                  type="button"
                  variant={item.variant}
                  className="min-h-12 w-full justify-start whitespace-normal px-3 text-left leading-tight"
                  disabled={disabled}
                  aria-busy={busy}
                  aria-label={`${item.label}. ${hint}`}
                  onClick={() => activate(action)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Icon className="size-4" strokeWidth={1.8} />
                  )}
                  {item.label}
                </Button>
              </span>
            );
          })}
        </div>
      </div>

      {composer === "order" ? (
        <TableOrderComposer
          tableId={selectedTable.id}
          appendToOrderId={appendToOrderId}
          onCancel={() => setComposer(null)}
          onCreated={async () => {
            await onChanged();
            setComposer(null);
          }}
        />
      ) : null}

      {cancelTarget ? (
        <CancellationReasonForm
          title={
            cancelTarget.kind === "void"
              ? `${cancelTarget.item.productName} hesaptan çıkarılıyor`
              : cancelTarget.kind === "item"
                ? `${cancelTarget.item.productName} iptali`
                : `${selectedOrder?.orderNumber ?? "Sipariş"} iptali`
          }
          description={
            cancelTarget.kind === "void"
              ? "Servis edilmiş kalem kayıtta kalır, yalnızca hesaptan düşülür."
              : cancelTarget.kind === "item"
                ? "Kalem kayıtta kalır, yalnızca iptal olarak işaretlenir."
                : "Sipariş kayıtta kalır, yalnızca iptal olarak işaretlenir."
          }
          confirmLabel={
            cancelTarget.kind === "void" ? "Hesaptan Çıkar" : "İptali Onayla"
          }
          reasons={
            cancelTarget.kind === "void" ? VOID_REASON_CODES : undefined
          }
          otherValue={cancelTarget.kind === "void" ? "OTHER" : "Diğer"}
          labelFor={
            cancelTarget.kind === "void"
              ? (code) => displayLabel(VOID_REASON_LABELS, code, "Diğer")
              : undefined
          }
          pending={cancelPending}
          onCancel={() => setCancelTarget(null)}
          onSubmit={(submission) => void submitCancellation(submission)}
        />
      ) : null}

      {selectedOrder && canRoleCancelOrder(role) && !cancelTarget ? (
        <Button
          type="button"
          variant="destructive"
          className="min-h-11 w-full"
          onClick={() => setCancelTarget({ kind: "order" })}
        >
          <Ban className="size-4" strokeWidth={1.8} />
          Siparişi İptal Et
        </Button>
      ) : null}

      <Separator />

      <TableOperationsPanel
        table={selectedTable}
        tables={tables}
        onChanged={onChanged}
      />

      {composer === "note" ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
          <label
            className="text-sm font-semibold text-foreground"
            htmlFor="table-note-input"
          >
            Masa notu
          </label>
          <Textarea
            id="table-note-input"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Ekibin görmesi gereken not"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setComposer(null)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={!noteText.trim() || pendingAction === "table-note"}
              aria-busy={pendingAction === "table-note"}
              onClick={submitNote}
            >
              Notu Kaydet
            </Button>
          </div>
        </div>
      ) : null}

    </div>
  ) : null;

  return renderLayout({
    detailBody,
    selectedTable,
    selectTable: setSelectedTableId,
    close: closeSheet,
  });
}
