"use client";

import Image from "next/image";
import { useState, type FormEvent, type ReactNode } from "react";
import { ChefHat, ChevronDown, ImagePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/admin/admin-ui";
import { CatalogTranslationEditor } from "@/components/admin/catalog-translation-editor";
import {
  MENU_HIGHLIGHT_LIMIT,
  useIsDesktop,
  type CategoryDraft,
  type ProductDraft,
} from "@/components/admin/use-menu-draft";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import { adminApi } from "@/lib/api/endpoints";
import { userErrorMessage } from "@/lib/api/error-message";
import type {
  AdminCategoryResult,
  AdminProductResult,
} from "@/lib/services/admin-menu-service";
import type { CatalogTranslations } from "@/lib/i18n/catalog-localization";

/**
 * The panels that open when an administrator touches something on the menu.
 *
 * One shell, two presentations: a phone gets a sheet from the bottom edge with
 * its actions pinned above the home indicator, a desktop gets a centred window.
 * The fields are the same either way — a restaurant manager should not have to
 * learn two forms.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function EditorShell({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly footer: ReactNode;
  readonly children: ReactNode;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <WindowDialogContent
          size="lg"
          title={title}
          description={description}
          render={<form onSubmit={onSubmit} />}
          footer={footer}
        >
          <div className="grid gap-5">{children}</div>
        </WindowDialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Never taller than the viewport, and its own scroll inside, so the
        // on-screen keyboard pushes the fields rather than the actions.
        className="max-h-[92dvh] rounded-t-2xl p-0"
      >
        <form onSubmit={onSubmit} className="flex max-h-[92dvh] flex-col">
          <SheetHeader className="border-b px-4 py-4 pr-12">
            <SheetTitle className="text-lg">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 overflow-y-auto px-4 py-4">{children}</div>
          <div className="sticky bottom-0 flex gap-2 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] [&>button]:flex-1">
            {footer}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------- product ---- */

export /**
 * The fields a restaurant fills in the first minute, and the ones it fills
 * later.
 *
 * Price, category, name and "is it on sale" are what somebody adding a dish
 * actually needs; portion text, tags, allergens and the highlight shelf are
 * real and stay reachable, one tap down, instead of standing between the owner
 * and a saved product.
 */
function MoreFields({ children }: { readonly children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-background">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Diğer bilgiler
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="grid gap-4 border-t p-3">{children}</div> : null}
    </div>
  );
}

export function ProductEditDialog({
  product,
  categories,
  featuredCount,
  saving,
  autoTranslateAvailable,
  onOpenChange,
  onStage,
  onArchived,
}: {
  readonly product: AdminProductResult;
  readonly categories: readonly AdminCategoryResult[];
  readonly featuredCount: number;
  readonly saving: boolean;
  readonly autoTranslateAvailable: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStage: (change: ProductDraft) => void;
  readonly onArchived: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [activeLocale, setActiveLocale] = useState("tr");
  const [translations, setTranslations] = useState<CatalogTranslations>(product.translations ?? {});
  const [price, setPrice] = useState(product.price);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [weight, setWeight] = useState(product.weightLabel ?? "");
  const [tags, setTags] = useState(product.tags.join(", "));
  const [allergens, setAllergens] = useState(product.allergens.join(", "));
  const [isActive, setIsActive] = useState(product.isActive);
  const [isAvailable, setIsAvailable] = useState(product.isAvailable);
  const [isFeatured, setIsFeatured] = useState(product.isFeatured);
  const [preview, setPreview] = useState(product.imageUrl || MENU_PLACEHOLDER_IMAGE);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // The rail draws three. A fourth would be chosen and then silently dropped.
  const featuredFull = featuredCount >= MENU_HIGHLIGHT_LIMIT && !product.isFeatured;

  function pickImage(file?: File) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("En fazla 5 MB boyutunda görsel seçin.");
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") setPreview(reader.result);
      },
      { once: true },
    );
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Ürün adı boş bırakılamaz.");
      return;
    }
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) {
      toast.error("Geçerli bir fiyat girin.");
      return;
    }
    if (!categoryId) {
      toast.error("Bir kategori seçin.");
      return;
    }
    if (Object.values(translations).some((translation) => !translation.name.trim())) {
      toast.error("Çeviri açıklaması olan her dil için ürün adı girin.");
      return;
    }

    setBusy(true);
    try {
      // A photograph is a file on a server, not a field in a form, so it goes
      // up now while everything else waits for the one Save at the top. The
      // other values stay on screen if the upload fails.
      if (imageFile) {
        await adminApi.uploadProductImage(product.id, imageFile);
        toast.success("Ürün fotoğrafı güncellendi.");
      }
    } catch (error) {
      toast.error(userErrorMessage(error, "Görsel yüklenemedi."));
      setBusy(false);
      return;
    }
    setBusy(false);

    // A draft is a diff, not a copy of the form. Re-sending an unchanged name
    // makes the server recompute the slug, and two dishes that happen to share
    // a name then collide on a unique index for a rename nobody asked for.
    const next: ProductDraft = {};
    const nextTags = tags.split(",").map((item) => item.trim()).filter(Boolean);
    const nextAllergens = allergens.split(",").map((item) => item.trim()).filter(Boolean);
    const nextDescription = description.trim() || null;
    const nextWeight = weight.trim() || null;
    const nextPrice = Number(price).toFixed(2);

    if (name.trim() !== product.name) next.name = name.trim();
    if (nextDescription !== product.description) next.description = nextDescription;
    if (nextPrice !== product.price) next.price = nextPrice;
    if (categoryId !== product.categoryId) next.categoryId = categoryId;
    if (nextWeight !== product.weightLabel) next.weightLabel = nextWeight;
    if (JSON.stringify(nextTags) !== JSON.stringify(product.tags)) next.tags = nextTags;
    if (JSON.stringify(nextAllergens) !== JSON.stringify(product.allergens)) {
      next.allergens = nextAllergens;
    }
    if (isActive !== product.isActive) next.isActive = isActive;
    if (isAvailable !== product.isAvailable) next.isAvailable = isAvailable;
    if (isFeatured !== product.isFeatured) next.isFeatured = isFeatured;
    if (JSON.stringify(translations) !== JSON.stringify(product.translations ?? {})) {
      next.translations = translations;
    }

    if (Object.keys(next).length > 0) onStage(next);
    onOpenChange(false);
  }

  return (
    <EditorShell
      open
      onOpenChange={onOpenChange}
      title={`${product.name} ürününü düzenle`}
      description="Değişiklikler önizlemeye hemen yansır, kaydedilene kadar müşteri menüsü değişmez."
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy || saving} aria-busy={busy}>
            Tamam
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="relative aspect-square overflow-hidden rounded-xl border bg-muted">
            <Image
              src={preview}
              alt=""
              fill
              sizes="160px"
              className="object-cover"
              unoptimized={preview.startsWith("data:")}
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-card px-3 text-xs font-bold transition-colors hover:bg-muted">
            <ImagePlus className="size-4" /> Fotoğrafı Değiştir
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => pickImage(event.target.files?.[0])}
            />
          </label>
        </div>

        <div className="grid content-start gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fiyat">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  className="h-11 pr-9 text-base"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                  ₺
                </span>
              </div>
            </Field>
            <Field label="Kategori">
              <NativeSelect
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="h-11 text-base"
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </div>
      </div>

      <CatalogTranslationEditor
        entityLabel="Ürün"
        entityType="PRODUCT"
        entityId={product.id}
        autoTranslateAvailable={autoTranslateAvailable}
        activeLocale={activeLocale}
        onActiveLocaleChange={setActiveLocale}
        baseName={name}
        baseDescription={description}
        translations={translations}
        onBaseNameChange={setName}
        onBaseDescriptionChange={setDescription}
        onTranslationsChange={setTranslations}
      />

      <MoreFields>
        <Field label="Porsiyon / Gramaj">
          <Input
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="Örn. 320 gr"
            className="h-11 text-base"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Etiketler" hint="Virgülle ayırın.">
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Popüler, Vejetaryen"
              className="h-11 text-base"
            />
          </Field>
          <Field label="Alerjenler" hint="Virgülle ayırın.">
            <Input
              value={allergens}
              onChange={(event) => setAllergens(event.target.value)}
              placeholder="Gluten, Süt ürünleri"
              className="h-11 text-base"
            />
          </Field>
        </div>
        <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-1 hover:bg-muted/35">
          <span>
            <span className="block text-sm font-bold">Şefin Önerisi</span>
            <span className="text-xs text-muted-foreground">
              {featuredFull
                ? `En fazla ${MENU_HIGHLIGHT_LIMIT} ürün Şefin Önerisi olarak seçilebilir.`
                : "Menünün üstündeki öneri şeridinde gösterilir"}
            </span>
          </span>
          <Switch
            checked={isFeatured}
            disabled={featuredFull}
            onCheckedChange={(checked) => {
              if (checked && featuredFull) {
                toast.error(`En fazla ${MENU_HIGHLIGHT_LIMIT} ürün Şefin Önerisi olarak seçilebilir.`);
                return;
              }
              setIsFeatured(checked);
            }}
            aria-label="Şefin Önerisi"
          />
        </label>
      </MoreFields>

      <div className="rounded-xl border bg-background p-2">
        <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/35">
          <span>
            <span className="block text-sm font-bold">Müşteri Menüsünde Göster</span>
            <span className="text-xs text-muted-foreground">Kapalıyken ürün QR menüde görünmez</span>
          </span>
          <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Müşteri menüsünde göster" />
        </label>
        <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/35">
          <span>
            <span className="block text-sm font-bold">Satışta</span>
            <span className="text-xs text-muted-foreground">Kapalıyken menüde &quot;Tükendi&quot; görünür</span>
          </span>
          <Switch checked={isAvailable} onCheckedChange={setIsAvailable} aria-label="Satışta" />
        </label>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs font-extrabold text-destructive">Tehlikeli işlem</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Arşivlenen ürün menüden kaldırılır, geçmiş siparişlerdeki kaydı korunur.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={saving}
          onClick={onArchived}
        >
          <Trash2 /> Ürünü Arşivle
        </Button>
      </div>
    </EditorShell>
  );
}

/* ------------------------------------------------------------ category ---- */

export function CategoryEditDialog({
  category,
  productCount,
  saving,
  autoTranslateAvailable,
  onOpenChange,
  onStage,
  onArchived,
}: {
  readonly category: AdminCategoryResult;
  readonly productCount: number;
  readonly saving: boolean;
  readonly autoTranslateAvailable: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStage: (change: CategoryDraft) => void;
  readonly onArchived: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [activeLocale, setActiveLocale] = useState("tr");
  const [translations, setTranslations] = useState<CatalogTranslations>(category.translations ?? {});
  const [isActive, setIsActive] = useState(category.isActive);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Kategori adı boş bırakılamaz.");
      return;
    }
    if (Object.values(translations).some((translation) => !translation.name.trim())) {
      toast.error("Çeviri açıklaması olan her dil için kategori adı girin.");
      return;
    }
    // Same rule as a dish: only what actually changed travels.
    const next: CategoryDraft = {};
    const nextDescription = description.trim() || null;
    if (name.trim() !== category.name) next.name = name.trim();
    if (nextDescription !== category.description) next.description = nextDescription;
    if (isActive !== category.isActive) next.isActive = isActive;
    if (JSON.stringify(translations) !== JSON.stringify(category.translations ?? {})) {
      next.translations = translations;
    }

    if (Object.keys(next).length > 0) onStage(next);
    onOpenChange(false);
  }

  return (
    <EditorShell
      open
      onOpenChange={onOpenChange}
      title={`${category.name} kategorisini düzenle`}
      description="Sıralamayı üstteki kategori menüsünden değiştirebilirsiniz."
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={saving}>
            Tamam
          </Button>
        </>
      }
    >
      <CatalogTranslationEditor
        entityLabel="Kategori"
        entityType="CATEGORY"
        entityId={category.id}
        autoTranslateAvailable={autoTranslateAvailable}
        activeLocale={activeLocale}
        onActiveLocaleChange={setActiveLocale}
        baseName={name}
        baseDescription={description}
        translations={translations}
        onBaseNameChange={setName}
        onBaseDescriptionChange={setDescription}
        onTranslationsChange={setTranslations}
      />
      <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl border bg-background px-3">
        <span>
          <span className="block text-sm font-bold">Müşteri Menüsünde Göster</span>
          <span className="text-xs text-muted-foreground">
            Kapalıyken kategori QR menüde görünmez; {productCount} ürünü silinmez
          </span>
        </span>
        <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Müşteri menüsünde göster" />
      </label>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs font-extrabold text-destructive">Tehlikeli işlem</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Arşivlenen kategori menüden kaldırılır, içindeki {productCount} ürün silinmez.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={saving}
          onClick={onArchived}
        >
          <Trash2 /> Kategoriyi Arşivle
        </Button>
      </div>
    </EditorShell>
  );
}

/* ------------------------------------------------------------ featured ---- */

export function FeaturedEditDialog({
  products,
  categories,
  onOpenChange,
  onStage,
}: {
  readonly products: readonly AdminProductResult[];
  readonly categories: readonly AdminCategoryResult[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onStage: (productId: string, change: ProductDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const categoryName = (id: string) => categories.find((item) => item.id === id)?.name ?? "";
  const chosen = products.filter((product) => product.isFeatured);
  const normalized = query.trim().toLocaleLowerCase("tr-TR");
  const candidates = products
    .filter((product) => !normalized || product.name.toLocaleLowerCase("tr-TR").includes(normalized))
    .slice(0, 40);

  function toggle(product: AdminProductResult, next: boolean) {
    if (next && chosen.length >= MENU_HIGHLIGHT_LIMIT) {
      toast.error(`En fazla ${MENU_HIGHLIGHT_LIMIT} ürün Şefin Önerisi olarak seçilebilir.`);
      return;
    }
    onStage(product.id, { isFeatured: next });
  }

  return (
    <EditorShell
      open
      onOpenChange={onOpenChange}
      title="Şefin Önerilerini düzenle"
      description={`Menünün üstünde en fazla ${MENU_HIGHLIGHT_LIMIT} ürün gösterilir. Seçili: ${chosen.length}`}
      onSubmit={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      footer={
        <Button type="submit">
          <ChefHat /> Tamam
        </Button>
      }
    >
      <Field label="Ürün ara">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ürün adı"
          className="h-11 text-base"
        />
      </Field>
      <div className="max-h-80 divide-y overflow-y-auto rounded-xl border">
        {candidates.map((product) => (
          <label
            key={product.id}
            className="flex min-h-14 items-center justify-between gap-3 px-3 hover:bg-muted/35"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{product.name}</span>
              <span className="text-xs text-muted-foreground">{categoryName(product.categoryId)}</span>
            </span>
            <Switch
              checked={product.isFeatured}
              onCheckedChange={(checked) => toggle(product, checked)}
              aria-label={`${product.name} Şefin Önerisi`}
            />
          </label>
        ))}
        {candidates.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ürün bulunamadı.</p>
        ) : null}
      </div>
    </EditorShell>
  );
}
