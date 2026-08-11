"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Edit3, GripVertical, Layers3, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel, DataToolbar, Field, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { categories as initialCategories } from "@/lib/mock-data";
import type { Category } from "@/types";

function slugify(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CategoriesManager() {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return categories
      .filter((category) => !normalized || category.name.toLocaleLowerCase("tr-TR").includes(normalized))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories, query]);

  function openNew() {
    setEditing(null);
    setName("");
    setActive(true);
    setDialogOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setName(category.name);
    setActive(category.active);
    setDialogOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Kategori adı boş bırakılamaz.");
      return;
    }
    if (editing) {
      setCategories((current) => current.map((category) => category.id === editing.id ? { ...category, name: trimmed, slug: slugify(trimmed), active } : category));
      toast.success("Kategori güncellendi.");
    } else {
      setCategories((current) => [...current, { id: `category-${Date.now()}`, name: trimmed, slug: slugify(trimmed), productCount: 0, active, sortOrder: current.length + 1 }]);
      toast.success("Yeni kategori eklendi.");
    }
    setDialogOpen(false);
  }

  function toggleCategory(id: string, checked: boolean) {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, active: checked } : category));
  }

  function moveCategory(id: string, direction: -1 | 1) {
    setCategories((current) => {
      const ordered = [...current].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = ordered.findIndex((category) => category.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return current;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return ordered.map((category, order) => ({ ...category, sortOrder: order + 1 }));
    });
  }

  function removeCategory(category: Category) {
    setCategories((current) => current.filter((item) => item.id !== category.id));
    toast.success(`${category.name} kategorisi kaldırıldı.`);
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kategoriler"
        description="QR menüdeki bölüm adlarını, sıralamayı ve görünürlük durumunu yönetin."
        actions={<Button className="h-10" onClick={openNew}><Plus /> Yeni Kategori</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam" value={categories.length} />
        <SummaryChip label="Aktif" value={categories.filter((category) => category.active).length} />
        <SummaryChip label="Toplam ürün" value={categories.reduce((sum, category) => sum + category.productCount, 0)} />
      </div>

      <AdminPanel contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-background pl-9" placeholder="Kategori ara" aria-label="Kategori ara" />
          </div>
          <p className="text-xs text-muted-foreground sm:ml-auto">Ok düğmeleriyle sıralamayı değiştirebilirsiniz.</p>
        </DataToolbar>

        {filtered.length ? (
          <div className="divide-y">
            {filtered.map((category, index) => (
              <div key={category.id} className="grid items-center gap-3 p-4 transition-colors hover:bg-muted/20 sm:grid-cols-[auto_minmax(0,1fr)_120px_130px_auto] sm:px-5">
                <div className="hidden size-9 items-center justify-center rounded-lg text-muted-foreground sm:flex"><GripVertical className="size-4" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-extrabold">{category.name}</p>{category.id === "featured" ? <span className="rounded-md bg-copper/12 px-2 py-0.5 text-[10px] font-bold text-burgundy">Sistem kategorisi</span> : null}</div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">/{category.slug}</p>
                </div>
                <div className="flex items-center gap-2 sm:block"><span className="text-xs text-muted-foreground sm:hidden">Ürün:</span><strong className="text-sm tabular-nums">{category.productCount}</strong></div>
                <label className="flex items-center gap-3 text-sm font-semibold"><Switch checked={category.active} onCheckedChange={(checked) => toggleCategory(category.id, checked)} aria-label={`${category.name} aktiflik durumu`} /><span>{category.active ? "Aktif" : "Pasif"}</span></label>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Yukarı taşı" disabled={index === 0} onClick={() => moveCategory(category.id, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Aşağı taşı" disabled={index === filtered.length - 1} onClick={() => moveCategory(category.id, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Düzenle" onClick={() => openEdit(category)}><Edit3 /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Sil" disabled={category.id === "featured"} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeCategory(category)}><Trash2 /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Layers3 className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Kategori bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Aramayı temizleyin veya yeni kategori oluşturun.</p></div></div>
        )}
      </AdminPanel>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-xl">{editing ? "Kategoriyi düzenle" : "Yeni kategori"}</DialogTitle>
              <DialogDescription>Kategori adı ve QR menü görünürlüğünü belirleyin.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5">
              <Field label="Kategori adı"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Örn. Zeytinyağlılar" className="h-10" autoFocus /></Field>
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl border bg-background px-3"><span><span className="block text-sm font-bold">Aktif</span><span className="text-xs text-muted-foreground">QR menüde göster</span></span><Switch checked={active} onCheckedChange={setActive} aria-label="Kategori aktif" /></label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button>
              <Button type="submit">{editing ? "Kaydet" : "Kategori Ekle"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

