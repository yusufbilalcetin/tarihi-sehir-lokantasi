"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Edit3, GripVertical, Layers3, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel, DataToolbar, Field, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useAdminMenu } from "@/components/admin/use-admin-menu";
import { adminApi } from "@/lib/api/endpoints";
import type { Category } from "@/types";

export function CategoriesManager() {
  const menu = useAdminMenu();
  const categories = menu.categoryViews;
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
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
    setImageUrl("");
    setActive(true);
    setDialogOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setName(category.name);
    setImageUrl(category.imageUrl ?? "");
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
    // Blank means "no cover": the menu then shows neutral artwork rather than
    // borrowing a dish photograph.
    const cover = imageUrl.trim() || null;
    const target = editing;
    void menu
      .run(
        () => target
          ? adminApi.updateCategory(target.id, { name: trimmed, imageUrl: cover, isActive: active })
          : adminApi.createCategory({
              name: trimmed,
              imageUrl: cover,
              isActive: active,
              sortOrder: categories.length + 1,
            }),
        target ? "Kategori güncellendi." : "Yeni kategori eklendi.",
      )
      .then((result) => {
        if (result) setDialogOpen(false);
      });
  }

  function toggleCategory(id: string, checked: boolean) {
    void menu.run(
      () => adminApi.updateCategory(id, { isActive: checked }),
      checked ? "Kategori menüde yayınlandı." : "Kategori menüden kaldırıldı.",
    );
  }

  // Reordering swaps the two rows' sort values; the list re-reads from the API.
  function moveCategory(id: string, direction: -1 | 1) {
    const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((category) => category.id === id);
    const targetIndex = index + direction;
    const current = ordered[index];
    const neighbour = ordered[targetIndex];
    if (!current || !neighbour) return;

    void menu.run(async () => {
      await adminApi.updateCategory(current.id, { sortOrder: neighbour.sortOrder });
      await adminApi.updateCategory(neighbour.id, { sortOrder: current.sortOrder });
    }, "Kategori sırası güncellendi.");
  }

  function removeCategory(category: Category) {
    void menu.run(
      () => adminApi.updateCategory(category.id, { archived: true }),
      `${category.name} kategorisi arşivlendi.`,
    );
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
        <RealtimeStatus status={menu.realtimeStatus} />
      </div>

      <AdminPanel contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-background pl-9" placeholder="Kategori ara" aria-label="Kategori ara" />
          </div>
          <p className="text-xs text-muted-foreground sm:ml-auto">Ok düğmeleriyle sıralamayı değiştirebilirsiniz.</p>
        </DataToolbar>

        {menu.error && !categories.length ? (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Layers3 className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Kategoriler yüklenemedi</p><p className="mt-1 text-sm text-muted-foreground">{menu.error.message}</p></div></div>
        ) : filtered.length ? (
          <div className="divide-y">
            {filtered.map((category, index) => (
              <div key={category.id} className="grid items-center gap-3 p-4 transition-colors hover:bg-muted/20 sm:grid-cols-[auto_minmax(0,1fr)_120px_130px_auto] sm:px-5">
                <div className="hidden size-9 items-center justify-center rounded-lg text-muted-foreground sm:flex"><GripVertical className="size-4" /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-extrabold">{category.name}</p>{!category.active ? <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">Pasif</span> : null}</div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">/{category.slug}</p>
                </div>
                <div className="flex items-center gap-2 sm:block"><span className="text-xs text-muted-foreground sm:hidden">Ürün:</span><strong className="text-sm tabular-nums">{category.productCount}</strong></div>
                <label className="flex items-center gap-3 text-sm font-semibold"><Switch checked={category.active} onCheckedChange={(checked) => toggleCategory(category.id, checked)} aria-label={`${category.name} aktiflik durumu`} /><span>{category.active ? "Aktif" : "Pasif"}</span></label>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Yukarı taşı" disabled={index === 0 || menu.saving} onClick={() => moveCategory(category.id, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Aşağı taşı" disabled={index === filtered.length - 1 || menu.saving} onClick={() => moveCategory(category.id, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Düzenle" onClick={() => openEdit(category)}><Edit3 /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Sil" disabled={menu.saving} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeCategory(category)}><Trash2 /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Layers3 className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Kategori bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Aramayı temizleyin veya yeni kategori oluşturun.</p></div></div>
        )}
      </AdminPanel>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <WindowDialogContent
          size="sm"
          title={editing ? "Kategoriyi düzenle" : "Yeni kategori"}
          description="Kategori adını, kapak görselini ve QR menü görünürlüğünü belirleyin."
          render={<form onSubmit={handleSubmit} />}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button>
              <Button type="submit" disabled={menu.saving} aria-busy={menu.saving}>{editing ? "Kaydet" : "Kategori Ekle"}</Button>
            </>
          }
        >
            <div className="grid gap-4">
              <Field label="Kategori adı"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Örn. Zeytinyağlılar" className="h-10" autoFocus /></Field>
              <Field label="Kapak görseli"><Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="/images/food/category-corbalar.jpg" className="h-10" /><span className="mt-1 block text-xs text-muted-foreground">Boş bırakılırsa kategori sade bir görselle gösterilir.</span></Field>
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl border bg-background px-3"><span><span className="block text-sm font-bold">Aktif</span><span className="text-xs text-muted-foreground">QR menüde göster</span></span><Switch checked={active} onCheckedChange={setActive} aria-label="Kategori aktif" /></label>
            </div>
        </WindowDialogContent>
      </Dialog>
    </div>
  );
}

