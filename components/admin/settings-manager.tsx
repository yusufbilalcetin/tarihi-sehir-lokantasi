"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BellRing,
  Building2,
  ChevronDown,
  ImagePlus,
  MenuSquare,
  Palette,
  Save,
  ShoppingBag,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, Field, NativeSelect } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { userErrorMessage } from "@/lib/api/error-message";
import { adminApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import type { RestaurantSettingsResult } from "@/lib/services/admin-settings-service";
import { cn } from "@/lib/utils";

/**
 * The restaurant's own settings, for the person who owns the restaurant.
 *
 * Two rules hold this screen together. Everything shown as saved is saved —
 * every control below maps to a real column, and the ones that do not are
 * marked and never sent. And nothing is named the way the database names it:
 * an operator reads "Servis Ücreti", not `serviceFeeRate`.
 */

/** Sections whose controls reach no persisted column, named so a test can read them. */
export const SETTINGS_PREVIEW_ONLY = [
  "Logo",
  "Çalışma saatleri",
  "Menü bannerı",
  "Panel bildirimleri",
  "Renkler",
] as const;

const SETTINGS_PREVIEW_NOTE = (
  <p className="rounded-xl border border-dashed bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
    Bu bölüm henüz kaydedilmiyor; yalnızca önizleme amaçlıdır.
  </p>
);

/** The currencies the restaurant may be run in, in the operator's own words. */
const CURRENCY_LABELS: Readonly<Record<string, string>> = {
  TRY: "Türk Lirası (₺)",
  EUR: "Euro (€)",
  USD: "ABD Doları ($)",
};

const LOCALE_LABELS: Readonly<Record<string, string>> = {
  "tr-TR": "Türkçe",
  "en-US": "İngilizce",
};

/** Turkey has one zone; the list stays short and real rather than exhaustive. */
const TIMEZONE_LABELS: Readonly<Record<string, string>> = {
  "Europe/Istanbul": "Türkiye (İstanbul)",
  "Europe/Berlin": "Orta Avrupa (Berlin)",
  "Europe/London": "Birleşik Krallık (Londra)",
  UTC: "UTC",
};

/**
 * The persisted half of this screen, and only that half.
 *
 * Every field here has a column behind it and is sent by the save button. A
 * control that is not in this shape does not reach the server, and its section
 * has to say so — which is what {@link SETTINGS_PREVIEW_ONLY} is for.
 */
export interface PersistedSettingsForm {
  // The restaurant itself — columns on `restaurants`.
  readonly name: string;
  readonly phone: string;
  readonly address: string;
  readonly currency: string;
  readonly timezone: string;
  readonly defaultLocale: string;
  // Menu and ordering — columns on `restaurant_settings`.
  readonly menuEnabled: boolean;
  readonly orderingEnabled: boolean;
  readonly introEnabled: boolean;
  readonly waiterApprovalRequired: boolean;
  readonly customerNotesEnabled: boolean;
  readonly menuImagesEnabled: boolean;
  readonly maxItemQuantity: number;
  readonly orderNotesMaxLength: number;
  // What a guest may ask for from the table.
  readonly waiterCallEnabled: boolean;
  readonly billRequestEnabled: boolean;
  readonly waiterCallCooldownSeconds: number;
  // Percentages: 10.00 means ten per cent.
  readonly serviceFeeRate: string;
  readonly taxRate: string;
}

export function settingsFormFromResult(settings: RestaurantSettingsResult): PersistedSettingsForm {
  return {
    name: settings.profile.name,
    phone: settings.profile.phone ?? "",
    address: settings.profile.address ?? "",
    currency: settings.profile.currency,
    timezone: settings.profile.timezone,
    defaultLocale: settings.profile.defaultLocale,
    menuEnabled: settings.menuEnabled,
    orderingEnabled: settings.orderingEnabled,
    introEnabled: settings.introEnabled,
    waiterApprovalRequired: settings.waiterApprovalRequired,
    customerNotesEnabled: settings.customerNotesEnabled,
    menuImagesEnabled: settings.menuImagesEnabled,
    maxItemQuantity: settings.maxItemQuantity,
    orderNotesMaxLength: settings.orderNotesMaxLength,
    waiterCallEnabled: settings.waiterCallEnabled,
    billRequestEnabled: settings.billRequestEnabled,
    waiterCallCooldownSeconds: settings.waiterCallCooldownSeconds,
    serviceFeeRate: settings.serviceFeeRate,
    taxRate: settings.taxRate,
  };
}

/** The patch is the form itself: nothing is dropped on the way to the server. */
export function settingsPatchFromForm(
  form: PersistedSettingsForm,
): Record<string, string | number | boolean> {
  return { ...form };
}

const EMPTY_FORM: PersistedSettingsForm = {
  name: "",
  phone: "",
  address: "",
  currency: "TRY",
  timezone: "Europe/Istanbul",
  defaultLocale: "tr-TR",
  menuEnabled: false,
  orderingEnabled: false,
  introEnabled: false,
  waiterApprovalRequired: true,
  customerNotesEnabled: false,
  menuImagesEnabled: true,
  maxItemQuantity: 20,
  orderNotesMaxLength: 500,
  waiterCallEnabled: false,
  billRequestEnabled: false,
  waiterCallCooldownSeconds: 30,
  serviceFeeRate: "0.00",
  taxRate: "0.00",
};

function SettingsSection({
  title,
  description,
  preview,
  children,
}: {
  title: string;
  description: string;
  preview?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card shadow-[var(--shadow-raised)]">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-5 p-5">
        {preview ? SETTINGS_PREVIEW_NOTE : null}
        {children}
      </div>
    </section>
  );
}

/**
 * The settings a restaurant changes once a year sit behind a disclosure.
 *
 * Not hidden — reachable in one tap, and open by keyboard like anything else —
 * but not competing with "sipariş açık mı" on the way in.
 */
function AdvancedSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border bg-card shadow-[var(--shadow-raised)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          <span className="block font-heading text-lg font-semibold">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Çoğu işletmenin değiştirmesi gerekmez.
          </span>
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="grid gap-5 border-t p-5">{children}</div> : null}
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-5 rounded-xl px-2 transition-colors hover:bg-muted/30">
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

/** A percentage box: the operator types 10, the server stores "10.00". */
function RateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          className="h-10 max-w-32 text-right"
          inputMode="decimal"
          value={value}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="text-sm font-bold text-muted-foreground">%</span>
      </div>
    </Field>
  );
}

export function SettingsManager() {
  const [form, setForm] = useState<PersistedSettingsForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Preview-only, and kept apart from `form` so they cannot reach the server.
  const [preview, setPreview] = useState({
    slogan: "",
    instagram: "",
    weekday: "10:00 - 22:00",
    weekend: "11:00 - 23:00",
    accent: "#681F25",
    logoName: "Henüz yüklenmedi",
    bannerName: "Henüz yüklenmedi",
    sound: true,
    newOrder: true,
  });

  const loadSettings = useCallback((signal: AbortSignal) => adminApi.settings(signal), []);
  const resource = useApiResource(loadSettings);
  const settings = resource.data;

  // Hydrated from the restaurant, every field of it: a control left on its
  // default tells the operator their restaurant is configured one way while it
  // is configured another.
  useEffect(() => {
    if (!settings) return;
    const timer = window.setTimeout(() => setForm(settingsFormFromResult(settings)), 0);
    return () => window.clearTimeout(timer);
  }, [settings]);

  const setField = useCallback(
    <TKey extends keyof PersistedSettingsForm>(key: TKey, value: PersistedSettingsForm[TKey]) =>
      setForm((current) => ({ ...current, [key]: value })),
    [],
  );

  async function saveSettings() {
    if (saving || !settings) return;
    setSaving(true);
    try {
      await adminApi.updateSettings({
        ...settingsPatchFromForm(form),
        // What the screen was showing. The server refuses if somebody else has
        // saved in the meantime, rather than letting this overwrite them.
        expectedVersion: settings.version,
      });
      await resource.refetch();
      toast.success("Ayarlar kaydedildi.");
    } catch (error) {
      // Whatever the server objected to, in its own words — a rate out of
      // range, a name left empty, or somebody else's save landing first.
      toast.error(userErrorMessage(error, "Ayarlar kaydedilemedi."));
    } finally {
      setSaving(false);
    }
  }

  // Gated on the settings having actually arrived, not on the loading flag:
  // `useApiResource` clears `loading` in a `finally`, so a failed GET would
  // otherwise arm the button over untouched defaults and write them back.
  const saveButton = (
    <Button
      className="h-10"
      disabled={saving || !settings}
      aria-busy={saving}
      onClick={() => void saveSettings()}
    >
      <Save /> Ayarları Kaydet
    </Button>
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ayarlar"
        description="İşletme bilgilerinizi, menü ve sipariş akışınızı buradan yönetin."
        actions={saveButton}
      />

      {resource.error && !settings ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm font-semibold text-destructive">
            Ayarlar yüklenemedi, kayıtlı ayarlara dokunulmadı: {resource.error.message}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void resource.refetch()}>
            Tekrar dene
          </Button>
        </div>
      ) : resource.error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
          Ayarlar yenilenemedi; son alınan değerler gösteriliyor.
        </p>
      ) : null}

      <Tabs defaultValue="business" className="gap-5">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-11 min-w-max bg-card p-1 ring-1 ring-border">
            <TabsTrigger value="business" className="h-9 px-3"><Building2 /> İşletme</TabsTrigger>
            <TabsTrigger value="menu" className="h-9 px-3"><MenuSquare /> Menü</TabsTrigger>
            <TabsTrigger value="orders" className="h-9 px-3"><ShoppingBag /> Sipariş</TabsTrigger>
            <TabsTrigger value="guest" className="h-9 px-3"><BellRing /> Misafir</TabsTrigger>
            <TabsTrigger value="appearance" className="h-9 px-3"><Palette /> Görünüm</TabsTrigger>
          </TabsList>
        </div>

        {/* ------------------------------------------------------- işletme */}
        <TabsContent value="business" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="grid gap-5">
            <SettingsSection
              title="İşletme bilgileri"
              description="Müşteri menüsünde ve belgelerde görünen bilgiler."
            >
              <Field label="İşletme adı">
                <Input
                  className="h-10"
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                />
              </Field>
              <Field label="Telefon" hint="Misafirlerin size ulaşacağı numara.">
                <Input
                  className="h-10"
                  value={form.phone}
                  onChange={(event) => setField("phone", event.target.value)}
                />
              </Field>
              <Field label="Adres">
                <Textarea
                  className="min-h-20"
                  value={form.address}
                  onChange={(event) => setField("address", event.target.value)}
                />
              </Field>
            </SettingsSection>

            <AdvancedSection title="Bölgesel ayarlar">
              <Field
                label="Para Birimi"
                hint="Menü ve kasa tutarlarının hangi para biriminde gösterileceğini belirler."
              >
                <NativeSelect
                  value={form.currency}
                  onChange={(event) => setField("currency", event.target.value)}
                >
                  {Object.entries(CURRENCY_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Dil" hint="Menünün misafire ilk açıldığındaki dili.">
                <NativeSelect
                  value={form.defaultLocale}
                  onChange={(event) => setField("defaultLocale", event.target.value)}
                >
                  {Object.entries(LOCALE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Saat Dilimi"
                hint="Gün sonu ve rapor saatlerini belirler."
              >
                <NativeSelect
                  value={form.timezone}
                  onChange={(event) => setField("timezone", event.target.value)}
                >
                  {Object.entries(TIMEZONE_LABELS).map(([zone, label]) => (
                    <option key={zone} value={zone}>{label}</option>
                  ))}
                </NativeSelect>
              </Field>
            </AdvancedSection>
          </div>

          <div className="grid gap-5">
            <SettingsSection title="Logo" description="Mevcut marka logosu." preview>
              <div className="rounded-xl border border-dashed bg-background p-4">
                <UploadCloud className="size-5 text-burgundy" aria-hidden="true" />
                <p className="mt-2 break-all text-sm font-bold">
                  {settings?.profile.logoUrl ?? preview.logoName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Logo yükleme henüz açık değil; mevcut logo burada görünür.
                </p>
                <label className="mt-3 inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg border bg-card px-3 text-xs font-bold opacity-60">
                  <ImagePlus className="size-4" aria-hidden="true" /> Dosya Seç
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled />
                </label>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Çalışma saatleri"
              description="Menüde gösterilecek servis saatleri."
              preview
            >
              <Field label="Hafta içi">
                <Input
                  className="h-10"
                  value={preview.weekday}
                  onChange={(event) => setPreview((c) => ({ ...c, weekday: event.target.value }))}
                />
              </Field>
              <Field label="Hafta sonu">
                <Input
                  className="h-10"
                  value={preview.weekend}
                  onChange={(event) => setPreview((c) => ({ ...c, weekend: event.target.value }))}
                />
              </Field>
            </SettingsSection>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------- menü */}
        <TabsContent value="menu" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection title="Menü" description="Misafirin QR ile gördüğü menü.">
            <ToggleRow
              label="Menü açık"
              description="Kapatırsanız QR menü misafire gösterilmez."
              checked={form.menuEnabled}
              onCheckedChange={(checked) => setField("menuEnabled", checked)}
            />
            <ToggleRow
              label="Ürün fotoğrafları"
              description="Yemek fotoğraflarını ürün kartlarında göster."
              checked={form.menuImagesEnabled}
              onCheckedChange={(checked) => setField("menuImagesEnabled", checked)}
            />
            <ToggleRow
              label="Karşılama ekranı"
              description="Menü açılırken kısa bir karşılama gösterilsin."
              checked={form.introEnabled}
              onCheckedChange={(checked) => setField("introEnabled", checked)}
            />
          </SettingsSection>

          <AdvancedSection title="Menü sınırları">
            <Field
              label="Bir üründen en fazla"
              hint="Misafirin tek seferde sepete ekleyebileceği adet."
            >
              <Input
                className="h-10 max-w-32"
                type="number"
                min={1}
                max={99}
                value={form.maxItemQuantity}
                onChange={(event) => setField("maxItemQuantity", Number(event.target.value))}
              />
            </Field>
            <Field
              label="Sipariş notu uzunluğu"
              hint="Misafirin yazabileceği en fazla karakter sayısı."
            >
              <Input
                className="h-10 max-w-32"
                type="number"
                min={0}
                max={1000}
                value={form.orderNotesMaxLength}
                onChange={(event) => setField("orderNotesMaxLength", Number(event.target.value))}
              />
            </Field>
          </AdvancedSection>
        </TabsContent>

        {/* ------------------------------------------------------- sipariş */}
        <TabsContent value="orders" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection title="Sipariş akışı" description="QR menüden gelen siparişler.">
            <ToggleRow
              label="QR siparişi"
              description="Misafirler masadan doğrudan sipariş gönderebilsin."
              checked={form.orderingEnabled}
              onCheckedChange={(checked) => setField("orderingEnabled", checked)}
            />
            <ToggleRow
              label="Garson onayı"
              description="Sipariş mutfağa düşmeden önce garson onaylasın."
              checked={form.waiterApprovalRequired}
              onCheckedChange={(checked) => setField("waiterApprovalRequired", checked)}
            />
            <ToggleRow
              label="Müşteri notu"
              description="Misafir ürüne ve siparişe not yazabilsin."
              checked={form.customerNotesEnabled}
              onCheckedChange={(checked) => setField("customerNotesEnabled", checked)}
            />
          </SettingsSection>

          <SettingsSection
            title="Vergi ve servis"
            description="Yeni siparişlere uygulanır. Geçmiş siparişlerin tutarı değişmez."
          >
            <RateField
              label="Vergi Oranı"
              hint="Hesaba eklenecek vergi yüzdesi."
              value={form.taxRate}
              onChange={(next) => setField("taxRate", next)}
            />
            <RateField
              label="Servis Ücreti"
              hint="Hesaba eklenecek servis yüzdesi."
              value={form.serviceFeeRate}
              onChange={(next) => setField("serviceFeeRate", next)}
            />
            <p className="rounded-xl border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
              Bir sipariş açıldığı andaki oranlarla hesaplanır. Bu oranları
              değiştirmek, açık veya kapanmış siparişlerin tutarını değiştirmez.
            </p>
          </SettingsSection>
        </TabsContent>

        {/* ------------------------------------------------------- misafir */}
        <TabsContent value="guest" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection
            title="Misafir talepleri"
            description="Misafirin masadan başlatabileceği talepler."
          >
            <ToggleRow
              label="Garson çağrısı"
              description="Misafir masadan garson çağırabilsin."
              checked={form.waiterCallEnabled}
              onCheckedChange={(checked) => setField("waiterCallEnabled", checked)}
            />
            <ToggleRow
              label="Hesap talebi"
              description="Misafir masadan hesap isteyebilsin."
              checked={form.billRequestEnabled}
              onCheckedChange={(checked) => setField("billRequestEnabled", checked)}
            />
            <Field
              label="Garson tekrar çağrılabilsin"
              hint="Aynı masanın arka arkaya çağrı göndermesini engeller."
            >
              <div className="flex items-center gap-2">
                <Input
                  className="h-10 max-w-32"
                  type="number"
                  min={5}
                  max={3600}
                  aria-label="Garson tekrar çağrılabilsin"
                  value={form.waiterCallCooldownSeconds}
                  onChange={(event) =>
                    setField("waiterCallCooldownSeconds", Number(event.target.value))
                  }
                />
                <span className="text-sm font-semibold text-muted-foreground">saniye sonra</span>
              </div>
            </Field>
          </SettingsSection>

          <SettingsSection
            title="Panel bildirimleri"
            description="Yönetim ve personel ekranlarında gösterilecek uyarılar."
            preview
          >
            <ToggleRow
              label="Bildirim sesi"
              description="Yeni olaylarda kısa bir uyarı sesi çal."
              checked={preview.sound}
              onCheckedChange={(checked) => setPreview((c) => ({ ...c, sound: checked }))}
            />
            <ToggleRow
              label="Yeni sipariş"
              description="QR menüden sipariş geldiğinde ekibe bildir."
              checked={preview.newOrder}
              onCheckedChange={(checked) => setPreview((c) => ({ ...c, newOrder: checked }))}
            />
          </SettingsSection>
        </TabsContent>

        {/* ------------------------------------------------------- görünüm */}
        <TabsContent value="appearance" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection title="Renkler" description="QR menüde kullanılacak vurgu rengi." preview>
            <div className="flex flex-wrap gap-3">
              {["#681F25", "#30382D", "#B98352", "#7C3A2D", "#435343"].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setPreview((c) => ({ ...c, accent: color }))}
                  aria-label={`${color} rengini seç`}
                  aria-pressed={preview.accent === color}
                  className="size-12 rounded-xl border-4 border-card ring-1 ring-border transition-transform active:scale-95"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Menü bannerı"
            description="Kategori alanının üstünde kullanılacak görsel."
            preview
          >
            <div className="rounded-xl border border-dashed bg-background p-4">
              <UploadCloud className="size-5 text-burgundy" aria-hidden="true" />
              <p className="mt-2 text-sm font-bold">{preview.bannerName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Önerilen oran 16:6.</p>
            </div>
          </SettingsSection>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end sm:hidden">{saveButton}</div>
    </div>
  );
}
