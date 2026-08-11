"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, ImageIcon, PackageOpen, RefreshCw, Settings2, Tags, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { categories, products } from "@/lib/mock-data";
import { StatusBadge } from "@/components/shared/status-badge";

export function MenuOverview() {
  const [menuOpen, setMenuOpen] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [showSoldOut, setShowSoldOut] = useState(true);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Menü yönetimi"
        description="QR menünüzün yayın durumunu, içerik sağlığını ve hızlı erişimlerini tek yerden yönetin."
        actions={
          <Button render={<Link href="/menu/demo-table" />} nativeButton={false} variant="outline" className="h-10 bg-card">
            <Eye /> Menüyü Önizle
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="overflow-hidden rounded-2xl border border-olive bg-olive p-5 text-cream shadow-[0_14px_40px_rgba(48,56,45,0.14)] sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-cream/65"><UtensilsCrossed className="size-4 text-gold" /> QR Menü</div>
              <h2 className="mt-3 font-heading text-2xl font-semibold">Menünüz yayında</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-cream/65">9 kategori ve 8 demo ürün müşteriler tarafından görüntülenebilir.</p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-cream/15 bg-cream/5 px-3 py-2.5">
              <span className="text-sm font-bold">{menuOpen ? "Açık" : "Kapalı"}</span>
              <Switch checked={menuOpen} onCheckedChange={setMenuOpen} aria-label="QR menü yayın durumu" className="data-checked:bg-gold" />
            </div>
          </div>
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-cream/12 bg-cream/5 p-3"><p className="text-xs text-cream/55">Kategori</p><strong className="mt-1 block text-xl">{categories.length}</strong></div>
            <div className="rounded-xl border border-cream/12 bg-cream/5 p-3"><p className="text-xs text-cream/55">Ürün</p><strong className="mt-1 block text-xl">{products.length}</strong></div>
            <div className="col-span-2 rounded-xl border border-cream/12 bg-cream/5 p-3 sm:col-span-1"><p className="text-xs text-cream/55">Tükendi</p><strong className="mt-1 block text-xl">{products.filter((product) => product.status === "sold-out").length}</strong></div>
          </div>
        </div>

        <AdminPanel title="Müşteri görünümü" description="Menüde gösterilecek temel seçenekler">
          <div className="space-y-1">
            <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-2 hover:bg-muted/35">
              <span><span className="block text-sm font-bold">Ürün fotoğrafları</span><span className="text-xs text-muted-foreground">Kartlarda görselleri göster</span></span>
              <Switch checked={showImages} onCheckedChange={setShowImages} aria-label="Ürün fotoğraflarını göster" />
            </label>
            <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-2 hover:bg-muted/35">
              <span><span className="block text-sm font-bold">Tükenen ürünler</span><span className="text-xs text-muted-foreground">Pasif olarak listede tut</span></span>
              <Switch checked={showSoldOut} onCheckedChange={setShowSoldOut} aria-label="Tükenen ürünleri göster" />
            </label>
          </div>
          <Button className="mt-4 w-full" variant="outline" onClick={() => toast.success("Menü görünüm ayarları kaydedildi.")}>
            <Settings2 /> Tercihleri Kaydet
          </Button>
        </AdminPanel>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/admin/categories" className="group rounded-2xl border bg-card p-5 shadow-[0_12px_35px_rgba(74,40,40,0.05)] transition-colors hover:border-copper/60">
          <div className="flex items-start justify-between gap-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-burgundy/8 text-burgundy"><Tags className="size-5" /></div>
            <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          <h2 className="mt-5 font-heading text-xl font-semibold">Kategoriler</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Sıralama, görünürlük ve kategori adlarını düzenleyin.</p>
        </Link>
        <Link href="/admin/products" className="group rounded-2xl border bg-card p-5 shadow-[0_12px_35px_rgba(74,40,40,0.05)] transition-colors hover:border-copper/60">
          <div className="flex items-start justify-between gap-4">
            <div className="flex size-11 items-center justify-center rounded-xl bg-olive/8 text-olive"><PackageOpen className="size-5" /></div>
            <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          <h2 className="mt-5 font-heading text-xl font-semibold">Ürünler</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Fiyat, açıklama, etiket ve stok durumlarını yönetin.</p>
        </Link>
      </div>

      <AdminPanel
        title="İçerik kontrolü"
        description="Menünün yayın kalitesini etkileyen başlıklar"
        action={<Button variant="ghost" size="sm" onClick={() => toast.success("İçerik kontrolü yenilendi.")}><RefreshCw /> Yenile</Button>}
        contentClassName="grid gap-3 sm:grid-cols-3"
      >
        <div className="rounded-xl border bg-background p-4"><ImageIcon className="size-5 text-burgundy" /><strong className="mt-3 block text-sm">Görsel kapsamı</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">8 ürünün 8’inde görsel mevcut.</p></div>
        <div className="rounded-xl border bg-background p-4"><PackageOpen className="size-5 text-burgundy" /><strong className="mt-3 block text-sm">Ürün durumu</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">1 ürün bugün tükendi.</p></div>
        <div className="rounded-xl border bg-background p-4"><Tags className="size-5 text-burgundy" /><strong className="mt-3 block text-sm">Yayın durumu</strong><div className="mt-2"><StatusBadge status={menuOpen ? "active" : "inactive"} /></div></div>
      </AdminPanel>
    </div>
  );
}
