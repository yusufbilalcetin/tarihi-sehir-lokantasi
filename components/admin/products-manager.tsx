"use client";

import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import { Edit3, ImagePlus, PackageOpen, Plus, Search, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel, DataToolbar, Field, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/status-badge";
import { categories, products as initialProducts } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";
import type { Product, ProductStatus } from "@/types";

interface ProductFormData {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  weight: string;
  tags: string;
  allergens: string;
  active: boolean;
  soldOut: boolean;
  featured: boolean;
  image: string;
}

const emptyForm: ProductFormData = {
  name: "",
  description: "",
  price: "",
  categoryId: categories[1]?.id ?? categories[0].id,
  weight: "",
  tags: "",
  allergens: "",
  active: true,
  soldOut: false,
  featured: false,
  image: "/images/food/mercimek-corbasi.png",
};

function toFormData(product: Product): ProductFormData {
  return {
    name: product.name,
    description: product.description,
    price: String(product.price),
    categoryId: product.categoryId,
    weight: product.weight ?? "",
    tags: product.tags.join(", "),
    allergens: product.allergens.join(", "),
    active: product.status !== "inactive",
    soldOut: product.status === "sold-out",
    featured: Boolean(product.featured),
    image: product.image,
  };
}

function ProductForm({
  product,
  onOpenChange,
  onSave,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  onSave: (form: ProductFormData) => void;
}) {
  const initialForm = product ? toFormData(product) : emptyForm;
  const [form, setForm] = useState<ProductFormData>(initialForm);
  const [previewUrl, setPreviewUrl] = useState(initialForm.image);

  function update<K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      setPreviewUrl(reader.result);
      update("image", reader.result);
    }, { once: true });
    reader.readAsDataURL(file);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.price || Number(form.price) <= 0) {
      toast.error("Ürün adı ve geçerli bir fiyat girin.");
      return;
    }
    onSave(form);
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex min-h-full flex-col">
          <SheetHeader className="border-b px-5 py-5 pr-12 sm:px-6">
            <SheetTitle className="text-xl">{product ? "Ürünü düzenle" : "Yeni ürün"}</SheetTitle>
            <SheetDescription>QR menüde gösterilecek ürün bilgilerini düzenleyin. Kaydetme işlemi demo state üzerinde çalışır.</SheetDescription>
          </SheetHeader>

          <div className="grid gap-6 px-5 pb-6 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="relative aspect-square overflow-hidden rounded-2xl border bg-muted">
                <Image src={previewUrl} alt="Ürün görseli önizlemesi" fill sizes="180px" className="object-cover" unoptimized={previewUrl.startsWith("data:")} />
              </div>
              <div className="flex flex-col justify-center rounded-2xl border border-dashed bg-background p-4">
                <UploadCloud className="size-6 text-burgundy" />
                <p className="mt-2 text-sm font-extrabold">Ürün fotoğrafı</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">JPG veya PNG seçin. Bu demoda dosya yalnızca yerel önizleme için kullanılır.</p>
                <label className="mt-3 inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-xs font-bold transition-colors hover:bg-muted">
                  <ImagePlus className="size-4" /> Görsel Seç
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => handleFile(event.target.files?.[0])} />
                </label>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Ürün adı" className="sm:col-span-2">
                <Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Örn. Hünkar Beğendi" className="h-10 bg-card" />
              </Field>
              <Field label="Açıklama" hint="Müşterinin menü kartında göreceği kısa açıklama." className="sm:col-span-2">
                <Textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Ürünün içeriğini ve hazırlama biçimini yazın." className="min-h-24 bg-card" />
              </Field>
              <Field label="Fiyat">
                <div className="relative"><Input type="number" min="0" step="1" value={form.price} onChange={(event) => update("price", event.target.value)} className="h-10 bg-card pr-10" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₺</span></div>
              </Field>
              <Field label="Kategori">
                <NativeSelect value={form.categoryId} onChange={(event) => update("categoryId", event.target.value)}>
                  {categories.filter((category) => category.id !== "featured").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Gramaj / porsiyon">
                <Input value={form.weight} onChange={(event) => update("weight", event.target.value)} placeholder="Örn. 320 gr" className="h-10 bg-card" />
              </Field>
              <Field label="Etiketler" hint="Virgülle ayırın.">
                <Input value={form.tags} onChange={(event) => update("tags", event.target.value)} placeholder="Popüler, Yeni" className="h-10 bg-card" />
              </Field>
              <Field label="Alerjenler" hint="Virgülle ayırın." className="sm:col-span-2">
                <Input value={form.allergens} onChange={(event) => update("allergens", event.target.value)} placeholder="Gluten, Süt ürünleri" className="h-10 bg-card" />
              </Field>
            </div>

            <div className="rounded-2xl border bg-background p-2">
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/35">
                <span><span className="block text-sm font-bold">Aktif ürün</span><span className="text-xs text-muted-foreground">Menüde yayınlanmaya hazır</span></span>
                <Switch checked={form.active} onCheckedChange={(checked) => update("active", checked)} aria-label="Ürün aktif" />
              </label>
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/35">
                <span><span className="block text-sm font-bold">Bugün tükendi</span><span className="text-xs text-muted-foreground">Sepete ekleme kapatılır</span></span>
                <Switch checked={form.soldOut} onCheckedChange={(checked) => update("soldOut", checked)} aria-label="Ürün tükendi" />
              </label>
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/35">
                <span><span className="block text-sm font-bold">Öne çıkan</span><span className="text-xs text-muted-foreground">Menünün üst bölümünde gösterilir</span></span>
                <Switch checked={form.featured} onCheckedChange={(checked) => update("featured", checked)} aria-label="Ürün öne çıkan" />
              </label>
            </div>
          </div>

          <SheetFooter className="sticky bottom-0 border-t bg-card">
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Vazgeç</Button>
              <Button type="submit" className="flex-1">{product ? "Değişiklikleri Kaydet" : "Ürünü Ekle"}</Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ProductsManager() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState<"all" | ProductStatus>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return products.filter((product) => {
      const matchesQuery = !normalized || product.name.toLocaleLowerCase("tr-TR").includes(normalized) || product.tags.some((tag) => tag.toLocaleLowerCase("tr-TR").includes(normalized));
      return matchesQuery && (categoryId === "all" || product.categoryId === categoryId) && (status === "all" || product.status === status);
    });
  }, [products, query, categoryId, status]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setFormOpen(true);
  }

  function saveProduct(form: ProductFormData) {
    const category = categories.find((item) => item.id === form.categoryId);
    const nextStatus: ProductStatus = form.soldOut ? "sold-out" : form.active ? "active" : "inactive";
    const shared = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      categoryId: form.categoryId,
      category: category?.name ?? "Diğer",
      image: form.image,
      weight: form.weight.trim(),
      tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
      allergens: form.allergens.split(",").map((item) => item.trim()).filter(Boolean),
      status: nextStatus,
      featured: form.featured,
    };

    if (editing) {
      setProducts((current) => current.map((product) => (product.id === editing.id ? { ...product, ...shared } : product)));
      toast.success("Ürün bilgileri güncellendi.");
    } else {
      setProducts((current) => [{ id: `demo-${Date.now()}`, ...shared }, ...current]);
      toast.success("Yeni ürün demo menüye eklendi.");
    }
    setFormOpen(false);
  }

  function removeProduct(product: Product) {
    setProducts((current) => current.filter((item) => item.id !== product.id));
    toast.success(`${product.name} listeden kaldırıldı.`);
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ürünler"
        description="Ürün içeriğini, fiyatları, menü durumunu ve müşteri görünümünü yönetin."
        actions={<Button className="h-10" onClick={openNew}><Plus /> Yeni Ürün</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam" value={products.length} />
        <SummaryChip label="Aktif" value={products.filter((product) => product.status === "active").length} />
        <SummaryChip label="Tükendi" value={products.filter((product) => product.status === "sold-out").length} />
        <SummaryChip label="Öne çıkan" value={products.filter((product) => product.featured).length} />
      </div>

      <AdminPanel contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-background pl-9" placeholder="Ürün veya etiket ara" aria-label="Ürün ara" />
          </div>
          <NativeSelect value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="sm:w-48" aria-label="Kategori filtresi">
            <option value="all">Tüm kategoriler</option>
            {categories.filter((category) => category.id !== "featured").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </NativeSelect>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value as "all" | ProductStatus)} className="sm:w-44" aria-label="Durum filtresi">
            <option value="all">Tüm durumlar</option>
            <option value="active">Aktif</option>
            <option value="inactive">Pasif</option>
            <option value="sold-out">Bugün tükendi</option>
          </NativeSelect>
        </DataToolbar>

        {filtered.length ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b bg-muted/25 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Ürün</th>
                    <th className="px-3 py-3 font-semibold">Kategori</th>
                    <th className="px-3 py-3 font-semibold">Fiyat</th>
                    <th className="px-3 py-3 font-semibold">Durum</th>
                    <th className="px-3 py-3 font-semibold">Etiket</th>
                    <th className="px-5 py-3 text-right font-semibold">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((product) => (
                    <tr key={product.id} className="transition-colors hover:bg-muted/25">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted"><Image src={product.image} alt="" fill sizes="48px" className="object-cover" unoptimized={product.image.startsWith("data:")} /></div>
                          <div className="min-w-0"><p className="max-w-64 truncate font-extrabold">{product.name}</p><p className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">{product.weight || "Porsiyon bilgisi yok"}</p></div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold">{product.category}</td>
                      <td className="px-3 py-3 font-extrabold tabular-nums">{formatCurrency(product.price)}</td>
                      <td className="px-3 py-3"><StatusBadge status={product.status} /></td>
                      <td className="px-3 py-3"><div className="flex max-w-56 flex-wrap gap-1">{product.tags.length ? product.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="bg-background text-[10px]">{tag}</Badge>) : <span className="text-xs text-muted-foreground">Etiket yok</span>}</div></td>
                      <td className="px-5 py-3"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" aria-label={`${product.name} ürününü düzenle`} onClick={() => openEdit(product)}><Edit3 /></Button><Button variant="ghost" size="icon-sm" aria-label={`${product.name} ürününü sil`} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeProduct(product)}><Trash2 /></Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-3 sm:grid-cols-2 lg:hidden">
              {filtered.map((product) => (
                <article key={product.id} className="rounded-xl border bg-background p-3">
                  <div className="flex gap-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted"><Image src={product.image} alt="" fill sizes="64px" className="object-cover" unoptimized={product.image.startsWith("data:")} /></div>
                    <div className="min-w-0 flex-1"><p className="truncate font-extrabold">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.category}</p><p className="mt-2 font-extrabold tabular-nums">{formatCurrency(product.price)}</p></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2"><StatusBadge status={product.status} /><div className="flex gap-1"><Button variant="ghost" size="icon-sm" aria-label="Düzenle" onClick={() => openEdit(product)}><Edit3 /></Button><Button variant="ghost" size="icon-sm" className="text-destructive" aria-label="Sil" onClick={() => removeProduct(product)}><Trash2 /></Button></div></div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><PackageOpen className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Ürün bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Filtreleri temizleyin veya yeni ürün ekleyin.</p><Button className="mt-4" onClick={openNew}><Plus /> Yeni Ürün</Button></div></div>
        )}
      </AdminPanel>

      {formOpen ? <ProductForm key={editing?.id ?? "new"} product={editing} onOpenChange={setFormOpen} onSave={saveProduct} /> : null}
    </div>
  );
}
