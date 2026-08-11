"use client";

import { useState, type ReactNode } from "react";
import { BellRing, Building2, Check, ImagePlus, MenuSquare, Palette, Save, ShoppingBag, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, Field, NativeSelect } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card shadow-[0_12px_35px_rgba(74,40,40,0.05)]">
      <div className="border-b px-5 py-4"><h2 className="font-heading text-lg font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
      <div className="grid gap-5 p-5">{children}</div>
    </section>
  );
}

function ToggleRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-5 rounded-xl px-2 transition-colors hover:bg-muted/30">
      <span><span className="block text-sm font-bold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span></span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  );
}

export function SettingsManager() {
  const [business, setBusiness] = useState({
    name: "Tarihi Şehir Lokantası",
    slogan: "Eski Usul • Yeni Nesil Lezzetler",
    phone: "0224 224 18 42",
    address: "Kayhan Mah. Ünlü Cad. No: 18, Osmangazi / Bursa",
    instagram: "@tarihisehirlokantasi",
    weekday: "10:00 - 22:00",
    weekend: "11:00 - 23:00",
  });
  const [menu, setMenu] = useState({ currency: "TRY", language: "tr", priceStyle: "symbol-after", images: true });
  const [order, setOrder] = useState({ enabled: true, waiterApproval: true, customerNote: true });
  const [notifications, setNotifications] = useState({ sound: true, waiterCall: true, newOrder: true, billRequest: true });
  const [accent, setAccent] = useState("#681F25");
  const [logoName, setLogoName] = useState("wordmark-transparent.png");
  const [bannerName, setBannerName] = useState("Henüz yüklenmedi");

  function updateBusiness(key: keyof typeof business, value: string) {
    setBusiness((current) => ({ ...current, [key]: value }));
  }

  function saveSettings() {
    toast.success("Ayarlar demo oturumu için kaydedildi.");
  }

  const saveButton = <Button className="h-10" onClick={saveSettings}><Save /> Değişiklikleri Kaydet</Button>;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Ayarlar" description="İşletme bilgilerini, sipariş akışını ve müşteri menüsü tercihlerini yönetin." actions={saveButton} />

      <Tabs defaultValue="business" className="gap-5">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-11 min-w-max bg-card p-1 ring-1 ring-border">
            <TabsTrigger value="business" className="h-9 px-3"><Building2 /> İşletme</TabsTrigger>
            <TabsTrigger value="menu" className="h-9 px-3"><MenuSquare /> Menü</TabsTrigger>
            <TabsTrigger value="orders" className="h-9 px-3"><ShoppingBag /> Sipariş</TabsTrigger>
            <TabsTrigger value="notifications" className="h-9 px-3"><BellRing /> Bildirim</TabsTrigger>
            <TabsTrigger value="appearance" className="h-9 px-3"><Palette /> Görünüm</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="business" className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <SettingsSection title="İşletme bilgileri" description="Müşteri menüsü ve resmi işletme görünümünde kullanılacak bilgiler.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="İşletme adı" className="sm:col-span-2"><Input value={business.name} onChange={(event) => updateBusiness("name", event.target.value)} className="h-10" /></Field>
              <Field label="Slogan" className="sm:col-span-2"><Input value={business.slogan} onChange={(event) => updateBusiness("slogan", event.target.value)} className="h-10" /></Field>
              <Field label="Telefon"><Input value={business.phone} onChange={(event) => updateBusiness("phone", event.target.value)} className="h-10" /></Field>
              <Field label="Instagram"><Input value={business.instagram} onChange={(event) => updateBusiness("instagram", event.target.value)} className="h-10" /></Field>
              <Field label="Adres" className="sm:col-span-2"><Textarea value={business.address} onChange={(event) => updateBusiness("address", event.target.value)} className="min-h-20" /></Field>
            </div>
          </SettingsSection>
          <div className="grid gap-5">
            <SettingsSection title="Çalışma saatleri" description="Menüde gösterilecek servis saatleri.">
              <Field label="Hafta içi"><Input value={business.weekday} onChange={(event) => updateBusiness("weekday", event.target.value)} className="h-10" /></Field>
              <Field label="Hafta sonu"><Input value={business.weekend} onChange={(event) => updateBusiness("weekend", event.target.value)} className="h-10" /></Field>
            </SettingsSection>
            <SettingsSection title="Logo" description="Mevcut marka logosunu değiştirin.">
              <div className="rounded-xl border border-dashed bg-background p-4"><UploadCloud className="size-5 text-burgundy" /><p className="mt-2 text-sm font-bold">{logoName}</p><label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-xs font-bold"><ImagePlus className="size-4" /> Dosya Seç<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? logoName)} /></label></div>
            </SettingsSection>
          </div>
        </TabsContent>

        <TabsContent value="menu" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection title="Dil ve para birimi" description="Müşteri menüsündeki bölgesel gösterim seçenekleri.">
            <Field label="Para birimi"><NativeSelect value={menu.currency} onChange={(event) => setMenu((current) => ({ ...current, currency: event.target.value }))}><option value="TRY">Türk Lirası (₺)</option><option value="EUR">Euro (€)</option><option value="USD">ABD Doları ($)</option></NativeSelect></Field>
            <Field label="Menü dili"><NativeSelect value={menu.language} onChange={(event) => setMenu((current) => ({ ...current, language: event.target.value }))}><option value="tr">Türkçe</option><option value="en">İngilizce</option></NativeSelect></Field>
            <Field label="Fiyat gösterimi"><NativeSelect value={menu.priceStyle} onChange={(event) => setMenu((current) => ({ ...current, priceStyle: event.target.value }))}><option value="symbol-after">120 ₺</option><option value="symbol-before">₺120</option><option value="code">120 TRY</option></NativeSelect></Field>
          </SettingsSection>
          <SettingsSection title="Ürün görünümü" description="Ürün kartlarının müşteri menüsündeki varsayılan görünümü.">
            <ToggleRow label="Ürün fotoğrafları" description="Yemek fotoğraflarını ürün kartlarında göster." checked={menu.images} onCheckedChange={(checked) => setMenu((current) => ({ ...current, images: checked }))} />
            <div className="rounded-xl border bg-background p-4"><p className="text-xs font-bold text-muted-foreground">Önizleme</p><div className="mt-3 flex items-center gap-3"><div className={cn("size-14 rounded-xl bg-copper/20", !menu.images && "grid place-items-center text-muted-foreground")}><MenuSquare className={cn("m-auto size-5", menu.images && "hidden")} /></div><div><p className="text-sm font-extrabold">Mercimek Çorbası</p><p className="mt-1 text-xs text-muted-foreground">{menu.priceStyle === "symbol-before" ? "₺120" : menu.priceStyle === "code" ? "120 TRY" : "120 ₺"}</p></div></div></div>
          </SettingsSection>
        </TabsContent>

        <TabsContent value="orders" className="max-w-3xl">
          <SettingsSection title="Sipariş akışı" description="QR menüden gelen siparişlerin işlenme biçimini belirleyin.">
            <ToggleRow label="QR siparişi" description="Müşterilerin masadan doğrudan sipariş göndermesine izin ver." checked={order.enabled} onCheckedChange={(checked) => setOrder((current) => ({ ...current, enabled: checked }))} />
            <ToggleRow label="Garson onayı" description="Sipariş mutfağa düşmeden önce garson onayı iste." checked={order.waiterApproval} onCheckedChange={(checked) => setOrder((current) => ({ ...current, waiterApproval: checked }))} />
            <ToggleRow label="Müşteri notu" description="Ürün ve sipariş notu alanlarını müşteriye göster." checked={order.customerNote} onCheckedChange={(checked) => setOrder((current) => ({ ...current, customerNote: checked }))} />
          </SettingsSection>
        </TabsContent>

        <TabsContent value="notifications" className="max-w-3xl">
          <SettingsSection title="Operasyon bildirimleri" description="Yönetim ve personel ekranlarında gösterilecek uyarıları seçin.">
            <ToggleRow label="Bildirim sesi" description="Yeni olaylarda kısa bir uyarı sesi çal." checked={notifications.sound} onCheckedChange={(checked) => setNotifications((current) => ({ ...current, sound: checked }))} />
            <ToggleRow label="Garson çağrısı" description="Müşteri garson çağırdığında bildirim göster." checked={notifications.waiterCall} onCheckedChange={(checked) => setNotifications((current) => ({ ...current, waiterCall: checked }))} />
            <ToggleRow label="Yeni sipariş" description="QR menüden sipariş geldiğinde ekibe bildir." checked={notifications.newOrder} onCheckedChange={(checked) => setNotifications((current) => ({ ...current, newOrder: checked }))} />
            <ToggleRow label="Hesap talebi" description="Müşteri hesap istediğinde kasa ve garsona bildir." checked={notifications.billRequest} onCheckedChange={(checked) => setNotifications((current) => ({ ...current, billRequest: checked }))} />
          </SettingsSection>
        </TabsContent>

        <TabsContent value="appearance" className="grid gap-5 lg:grid-cols-2">
          <SettingsSection title="Restoran renkleri" description="QR menüde kullanılacak ana vurgu rengini seçin.">
            <div className="flex flex-wrap gap-3">
              {["#681F25", "#30382D", "#B98352", "#7C3A2D", "#435343"].map((color) => <button key={color} type="button" onClick={() => setAccent(color)} aria-label={`${color} rengini seç`} className="grid size-12 place-items-center rounded-xl border-4 border-card ring-1 ring-border transition-transform active:scale-95" style={{ backgroundColor: color }}>{accent === color ? <Check className="size-5 text-white" /> : null}</button>)}
            </div>
            <Field label="Renk kodu"><Input value={accent} onChange={(event) => setAccent(event.target.value)} className="h-10 font-mono" /></Field>
          </SettingsSection>
          <SettingsSection title="Menü bannerı" description="Kategori alanının üstünde kullanılacak yatay görsel.">
            <div className="rounded-xl border border-dashed bg-background p-4"><UploadCloud className="size-5 text-burgundy" /><p className="mt-2 text-sm font-bold">{bannerName}</p><p className="mt-1 text-xs text-muted-foreground">Önerilen oran 16:6, JPG veya PNG.</p><label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-xs font-bold"><ImagePlus className="size-4" /> Banner Seç<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => setBannerName(event.target.files?.[0]?.name ?? bannerName)} /></label></div>
          </SettingsSection>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end sm:hidden">{saveButton}</div>
    </div>
  );
}
