"use client";

import { useRef, useState } from "react";
import { Languages, Sparkles } from "lucide-react";

import { Field, NativeSelect } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/client";
import { adminApi } from "@/lib/api/endpoints";
import {
  mergeAutoTranslatedDraft,
  type CatalogTranslations,
} from "@/lib/i18n/catalog-localization";
import {
  DEFAULT_MENU_LANGUAGE,
  MENU_LANGUAGES,
  getMenuLanguage,
} from "@/lib/i18n/languages";
import { SUPPORTED_MENU_LOCALE_CODES } from "@/lib/i18n/supported-locales";
import type { CatalogEntityType } from "@/lib/services/menu-auto-translate-service";

const QUICK_LOCALES = ["tr", "en", "ar", "de"] as const;

type AutoState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly message: string; readonly partial: boolean }
  | { readonly kind: "error"; readonly message: string };

export function CatalogTranslationEditor({
  entityLabel,
  entityType,
  entityId,
  autoTranslateAvailable,
  activeLocale,
  onActiveLocaleChange,
  baseName,
  baseDescription,
  translations,
  onBaseNameChange,
  onBaseDescriptionChange,
  onTranslationsChange,
}: {
  readonly entityLabel: string;
  readonly entityType: CatalogEntityType;
  readonly entityId: string;
  readonly autoTranslateAvailable: boolean;
  readonly activeLocale: string;
  readonly onActiveLocaleChange: (locale: string) => void;
  readonly baseName: string;
  readonly baseDescription: string;
  readonly translations: CatalogTranslations;
  readonly onBaseNameChange: (value: string) => void;
  readonly onBaseDescriptionChange: (value: string) => void;
  readonly onTranslationsChange: (value: CatalogTranslations) => void;
}) {
  const defaultLanguage = getMenuLanguage(DEFAULT_MENU_LANGUAGE)!;
  const activeLanguage = getMenuLanguage(activeLocale) ?? defaultLanguage;
  const isDefault = activeLanguage.code === DEFAULT_MENU_LANGUAGE;
  const current = translations[activeLanguage.code];
  const name = isDefault ? baseName : current?.name ?? "";
  const description = isDefault ? baseDescription : current?.description ?? "";
  const [auto, setAuto] = useState<AutoState>({ kind: "idle" });
  // State lands a render later than a second click arrives, so the button's
  // `disabled` cannot be the only guard: two fast clicks would otherwise send
  // two runs of up to 108 languages each.
  const running = useRef(false);

  // Counted from the draft the administrator is looking at, not fetched: the
  // number is only there to say how much work the button is about to do.
  const missingCount = SUPPORTED_MENU_LOCALE_CODES.filter(
    (locale) =>
      locale !== DEFAULT_MENU_LANGUAGE && !translations[locale]?.name.trim(),
  ).length;

  function updateTranslation(next: { name?: string; description?: string }) {
    if (isDefault) {
      if (next.name !== undefined) onBaseNameChange(next.name);
      if (next.description !== undefined) onBaseDescriptionChange(next.description);
      return;
    }

    const nextName = next.name ?? current?.name ?? "";
    const nextDescription = next.description ?? current?.description ?? "";
    const updated = { ...translations };
    updated[activeLanguage.code] = {
      name: nextName,
      description: nextDescription.trim() ? nextDescription : null,
    };
    onTranslationsChange(updated);
  }

  /**
   * Runs against the saved row, never against what is on screen: the request
   * carries an id and nothing else, so an unsaved edit in this form cannot be
   * translated by accident before the administrator has approved it.
   */
  async function runAutoTranslate() {
    if (running.current) return;
    running.current = true;
    setAuto({ kind: "running" });
    try {
      const result = await adminApi.autoTranslate({ entityType, entityId });
      // The server is the authority on what was written; the form catches up so
      // the administrator can read the new languages without reopening it —
      // except where they have already typed something themselves.
      const refreshed = await adminApi.menu();
      const rows = entityType === "PRODUCT" ? refreshed.products : refreshed.categories;
      const saved = rows.find((row) => row.id === entityId)?.translations;
      onTranslationsChange(mergeAutoTranslatedDraft(translations, saved, result.translated));
      setAuto({
        kind: "done",
        partial: result.failed.length > 0,
        message: result.failed.length
          ? `${result.translated.length} dil çevrildi, ${result.failed.length} dil başarısız.`
          : `${result.translated.length} dil çevrildi.`,
      });
    } catch (error) {
      setAuto({
        kind: "error",
        message:
          error instanceof ApiClientError ? error.message : "Otomatik çeviri tamamlanamadı.",
      });
    } finally {
      running.current = false;
    }
  }

  return (
    <section className="rounded-xl border bg-background p-3 sm:p-4" aria-labelledby={`${entityLabel}-translations-title`}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <Languages className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id={`${entityLabel}-translations-title`} className="text-sm font-extrabold">
            Katalog dilleri
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Türkçe zorunludur. Diğer diller boş kalabilir; müşteri menüsü Türkçe metne geri döner.
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Hızlı dil seçimi">
        {QUICK_LOCALES.map((locale) => {
          const language = getMenuLanguage(locale);
          if (!language) return null;
          return (
            <Button
              key={locale}
              type="button"
              variant={activeLanguage.code === locale ? "default" : "outline"}
              className="min-h-11 min-w-14 shrink-0 px-3"
              role="tab"
              aria-selected={activeLanguage.code === locale}
              onClick={() => onActiveLocaleChange(locale)}
            >
              {locale.toLocaleUpperCase("en-US")}
            </Button>
          );
        })}
      </div>

      <Field label="Tüm desteklenen diller">
        <NativeSelect
          value={activeLanguage.code}
          onChange={(event) => onActiveLocaleChange(event.target.value)}
          className="h-11 text-base"
        >
          {MENU_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code}>
              {language.nativeName} · {language.turkishName} ({language.code})
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div className="mt-4 grid gap-4" dir={activeLanguage.direction}>
        <Field
          label={`${entityLabel} Adı · ${activeLanguage.nativeName}`}
          hint={isDefault ? "Zorunlu · ana katalog metni" : "İsteğe bağlı"}
        >
          <Input
            value={name}
            aria-label={entityLabel === "Ürün" ? "Ürün Adı" : "Kategori Adı"}
            required={isDefault}
            maxLength={entityLabel === "Kategori" ? 120 : 180}
            onChange={(event) => updateTranslation({ name: event.target.value })}
            className="h-11 text-base"
            lang={activeLanguage.locale}
            dir={activeLanguage.direction}
          />
        </Field>
        <Field label={`Açıklama · ${activeLanguage.nativeName}`} hint="İsteğe bağlı · düz metin">
          <Textarea
            value={description ?? ""}
            maxLength={2000}
            rows={3}
            onChange={(event) => updateTranslation({ description: event.target.value })}
            className="text-base"
            lang={activeLanguage.locale}
            dir={activeLanguage.direction}
          />
        </Field>
      </div>

      {!isDefault && !name.trim() && description.trim() ? (
        <p className="mt-2 text-xs font-semibold text-destructive" role="alert">
          Açıklamayı kaydetmek için bu dilde bir ad girin.
        </p>
      ) : null}

      <div className="mt-4 rounded-lg border bg-muted/30 p-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={!autoTranslateAvailable || auto.kind === "running"}
          aria-busy={auto.kind === "running"}
          onClick={() => void runAutoTranslate()}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {auto.kind === "running" ? "Çevriliyor…" : "Diğer Dillere Otomatik Çevir"}
        </Button>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {autoTranslateAvailable
            ? `Kaydedilmiş metin kaynak alınır. ${missingCount} eksik dil çevrilecek; elle girdiğiniz çeviriler korunur.`
            : "Otomatik çeviri sağlayıcısı yapılandırılmamış. Diller elle girilebilir."}
        </p>
        {auto.kind === "done" ? (
          <p
            className={`mt-2 text-xs font-semibold ${auto.partial ? "text-destructive" : "text-primary"}`}
            role="status"
          >
            {auto.message}
          </p>
        ) : null}
        {auto.kind === "error" ? (
          <p className="mt-2 text-xs font-semibold text-destructive" role="alert">
            {auto.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
