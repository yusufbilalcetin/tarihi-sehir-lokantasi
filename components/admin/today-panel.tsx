"use client";

import Link from "next/link";
import { AlertTriangle, Boxes, CalendarDays, ClipboardCheck, ClipboardList, Factory, PackageCheck, ShoppingBag, TrendingUp, Truck, WalletCards, type LucideIcon } from "lucide-react";

import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ApiResult } from "@/lib/api/response";
import type { ErpOverview } from "@/lib/repositories/erp-repository";

/**
 * "Bugün ne oluyor? Şimdi ne yapmam gerekiyor?"
 *
 * One panel, rendered on both the manager's home and the ERP screen, reading
 * one bounded endpoint. It lives here rather than in either screen so the two
 * can never drift into disagreeing about how many items are critical — and so
 * neither has to re-derive a warning from a second query.
 */

async function readOverview(signal: AbortSignal): Promise<ErpOverview> {
  const response = await fetch("/api/admin/erp", { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json() as ApiResult<ErpOverview>;
  if (!response.ok || !payload.success) throw new Error(payload.success ? "ERP özeti alınamadı." : payload.error.message);
  return payload.data;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, icon: Icon, warning = false }: { label: string; value: React.ReactNode; icon: LucideIcon; warning?: boolean }) {
  return (
    <Card className={warning ? "border-destructive/35 bg-destructive/5" : ""}>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={warning ? "flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive" : "flex size-10 items-center justify-center rounded-xl bg-olive/10 text-olive"}><Icon className="size-5" /></span>
        <span className="min-w-0"><span className="block text-xl font-bold tabular-nums">{value}</span><span className="block truncate text-xs text-muted-foreground">{label}</span></span>
      </CardContent>
    </Card>
  );
}

/**
 * A warning is a sentence a manager can act on, and the action is the module
 * that already owns it. Nothing here re-implements a command: every card links
 * into the screen where the work is actually done, so the dashboard can never
 * become a second, diverging copy of an ERP form.
 */
function warningsFor(overview: ErpOverview) {
  const warnings: { key: string; text: string; href: string; action: string }[] = [];
  if (overview.counts.criticalStock > 0) warnings.push({ key: "stock", text: `${overview.counts.criticalStock} ürün kritik stokta`, href: "/admin/inventory", action: "Stoğa git" });
  if (overview.counts.pendingGoodsReceipts > 0) warnings.push({ key: "receipt", text: `${overview.counts.pendingGoodsReceipts} siparişin mal kabulü bekliyor`, href: "/admin/purchasing", action: "Mal kabule git" });
  if (overview.today.incompleteProduction > 0) warnings.push({ key: "production", text: `Bugün ${overview.today.incompleteProduction} üretim tamamlanmadı`, href: "/admin/production", action: "Üretime git" });
  if (overview.today.reservations > 0) warnings.push({ key: "reservation", text: `Bugün ${overview.today.reservations} rezervasyon var`, href: "/admin/reservations", action: "Rezervasyonlara git" });
  if (overview.counts.openAttendance > 0) warnings.push({ key: "attendance", text: `${overview.counts.openAttendance} personelin çıkış kaydı açık`, href: "/admin/attendance", action: "Puantaja git" });
  if (overview.counts.openSupplierInvoices > 0) warnings.push({ key: "payable", text: `${overview.counts.openSupplierInvoices} tedarikçi faturası ödenmedi`, href: "/admin/payables", action: "Borçlara git" });
  return warnings;
}

const quickActions: readonly { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Stok Hareketi", href: "/admin/inventory#action-adjust", icon: Boxes },
  { label: "Fire Gir", href: "/admin/waste#action-waste", icon: TrendingUp },
  { label: "Üretim Başlat", href: "/admin/production#action-plan", icon: Factory },
  { label: "Mal Kabul", href: "/admin/purchasing#action-receipt", icon: PackageCheck },
  { label: "Satın Alma", href: "/admin/purchasing#action-po", icon: ClipboardList },
  { label: "Tedarikçi Ödemesi", href: "/admin/payables#action-payment", icon: WalletCards },
  { label: "Rezervasyon", href: "/admin/reservations#action-reservation", icon: CalendarDays },
  { label: "Puantaj Düzelt", href: "/admin/attendance#action-attendanceCorrection", icon: ClipboardCheck },
  { label: "Vardiya", href: "/admin/schedules", icon: ClipboardCheck },
  { label: "Paket / Kurye", href: "/admin/fulfillment", icon: ShoppingBag },
  { label: "Tedarikçiler", href: "/admin/suppliers", icon: Truck },
];


/**
 * The four things a restaurant must enter itself before the ERP can do
 * anything, in the order they depend on each other.
 *
 * Completion is read from the database counts on every render — there is no
 * "onboarding complete" flag to drift out of step with reality. Waste, goods
 * receipt, payables, attendance, reservations and fulfilment are deliberately
 * absent: they fill themselves from daily operation and are not setup steps.
 *
 * The card disappears once all four are done, so it never becomes furniture.
 */
export function SetupChecklist({ overview }: { overview: ErpOverview }) {
  const steps = [
    { done: overview.counts.warehouses > 0, todo: "Depo oluştur", done_: "Depo hazır", href: "/admin/warehouses" },
    { done: overview.counts.inventoryItems > 0, todo: "Stok ürünlerini ekle", done_: "Stok ürünleri hazır", href: "/admin/inventory" },
    { done: overview.counts.suppliers > 0, todo: "Tedarikçileri ekle", done_: "Tedarikçiler hazır", href: "/admin/suppliers" },
    { done: overview.counts.activeRecipes > 0, todo: "Reçeteleri oluştur", done_: "Reçeteler hazır", href: "/admin/recipes" },
  ];
  if (steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);

  return (
    <Card className="border-olive/30 bg-olive/5">
      <CardContent className="p-4">
        <p className="font-heading text-base font-semibold">İlk kurulum</p>
        <p className="mt-1 text-sm text-muted-foreground">Stok, üretim ve satın alma ekranları bu dört adım tamamlanınca çalışmaya başlar.</p>
        <ul className="mt-3 space-y-1.5">
          {steps.map((step) => (
            <li key={step.href} className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className={step.done ? "text-status-success" : "text-text-muted"}>{step.done ? "✓" : "○"}</span>
              <span className={step.done ? "text-muted-foreground line-through" : "font-semibold"}>{step.done ? step.done_ : step.todo}</span>
            </li>
          ))}
        </ul>
        {next ? (
          <Button nativeButton={false} size="sm" className="mt-3" render={<Link href={next.href} />}>{next.todo}</Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TodayPanel({
  overview,
  error,
  onRetry,
}: {
  readonly overview: ErpOverview | null;
  readonly error?: unknown;
  readonly onRetry?: () => void;
}) {
  const warnings = overview ? warningsFor(overview) : [];
  // A figure that has not arrived is not a figure of zero, and a figure that
  // failed to arrive is not one still loading. Without the third case a broken
  // endpoint leaves this panel saying "yükleniyor…" forever, which is the worst
  // of the three: the manager waits for something that is never coming.
  const failed = Boolean(error);
  const pending = overview === null && !failed;
  // Both "not yet" and "failed" show a dash in the tiles; the sentence below
  // the tiles is what tells the two apart.
  const placeholder = "—";

  return (
    <div className="space-y-8">
      <Section title="Bugün" hint="Bugünün kapanmış satışı, açık işi ve bugüne yazılmış operasyon kayıtları.">
        {/* Four, not six. Production and waste are ERP figures a manager reads
            on the ERP screen when they are working on stock; on the home screen
            they only competed with the day's sales and the open orders. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Bugünkü satış" value={overview ? <Money amount={overview.today.sales} /> : placeholder} icon={TrendingUp} />
          <Metric label="Bugünkü sipariş adedi" value={overview ? overview.today.orderCount : placeholder} icon={PackageCheck} />
          <Metric label="Açık sipariş" value={overview ? overview.today.openOrders : placeholder} icon={ClipboardList} />
          <Metric label="Kritik stok" value={overview ? overview.counts.criticalStock : placeholder} icon={Boxes} warning={overview !== null && overview.counts.criticalStock > 0} />
        </div>
      </Section>

      <Section title="Dikkat gerektirenler" hint="Her uyarı, işin yapıldığı ekrana götürür.">
        {failed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger/25 bg-status-danger-tint/40 px-4 py-3">
            <span className="text-sm font-semibold text-status-danger">Bugünün işletme durumu alınamadı.</span>
            {onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>Tekrar dene</Button>
            ) : null}
          </div>
        ) : pending ? (
          <p className="rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">Durum bilgisi yükleniyor…</p>
        ) : warnings.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {warnings.map((warning) => (
              <Card key={warning.key} className="border-status-warning/30 bg-status-warning-tint/50">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <span className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 shrink-0 text-status-warning" aria-hidden="true" />{warning.text}</span>
                  <Button nativeButton={false} size="sm" variant="outline" render={<Link href={warning.href} />}>{warning.action}</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">Şu an dikkat gerektiren bir durum yok.</p>
        )}
      </Section>
    </div>
  );
}

/**
 * The eleven ERP entry points, rendered only where ERP work is done.
 *
 * They used to sit under the manager's home, where ten of the eleven were
 * things nobody does between lunch and dinner. They are unchanged — still
 * links into the module that owns the form, never a second copy of it.
 */
export function QuickActionsSection() {
  return (
    <Section title="Hızlı işlemler" hint="İşlemler ilgili modülde yapılır; burada ikinci bir form tutulmaz.">
      <div className="flex flex-wrap gap-2">
        {quickActions.map((action) => (
          <Button key={action.label} nativeButton={false} variant="outline" size="sm" className="min-h-10" render={<Link href={action.href} />}><action.icon className="size-4" aria-hidden="true" />{action.label}</Button>
        ))}
      </div>
    </Section>
  );
}

export { readOverview, Section, Metric, warningsFor, quickActions };
