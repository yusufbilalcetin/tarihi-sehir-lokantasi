"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/admin/admin-ui";
import { QrPrintSheet } from "@/components/admin/qr-print-sheet";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import {
  qrCardFileName,
  renderQrCardDataUrl,
  type QrCardBackground,
  type QrCardBackgroundFit,
  type QrCardBackgroundMode,
  type QrCardBackgroundPosition,
} from "@/lib/qr/qr-card-canvas";
import {
  QR_CARD_DEFAULT_DPI,
  QR_CARD_DEFAULT_PRESET,
  QR_CARD_PRESETS,
  customSizeError,
  qrCardPixelSize,
  resolveQrCardSize,
  type QrCardOrientation,
  type QrCardPresetId,
} from "@/lib/qr/qr-card-layout";

/** Wide enough to judge the card, small enough to redraw on every keystroke. */
const PREVIEW_WIDTH_PX = 460;
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface QrPrintCard {
  readonly tableName: string;
  readonly menuUrl: string;
}

function centimetres(millimetres: number): string {
  return (millimetres / 10).toFixed(1);
}

/**
 * The step between "this is the code" and paper.
 *
 * A table card is a physical object — it has to fit a stand, sit next to the
 * cutlery and still scan — so printing it is a decision, not a reflex. The
 * choices here are the ones a restaurant actually makes: how big, which way up,
 * and whether the house's own photograph goes behind it. Everything else stays
 * decided.
 *
 * The preview is not a mock-up of the card: it is the same canvas renderer at a
 * screen-sized resolution, so approving it approves the print.
 */
export function QrPrintDesigner({
  open,
  onOpenChange,
  cards,
  restaurantName,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly cards: readonly QrPrintCard[];
  readonly restaurantName: string;
}) {
  const [presetId, setPresetId] = useState<QrCardPresetId>(QR_CARD_DEFAULT_PRESET);
  const [customWidth, setCustomWidth] = useState("10.0");
  const [customHeight, setCustomHeight] = useState("15.0");
  const [orientation, setOrientation] = useState<QrCardOrientation>("portrait");
  const [backgroundMode, setBackgroundMode] = useState<QrCardBackgroundMode>("none");
  const [backgroundFit, setBackgroundFit] = useState<QrCardBackgroundFit>("cover");
  const [backgroundPosition, setBackgroundPosition] =
    useState<QrCardBackgroundPosition>("center");
  const [backgroundOpacity, setBackgroundOpacity] = useState(25);
  const [soften, setSoften] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [backgroundName, setBackgroundName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printImages, setPrintImages] = useState<readonly string[]>([]);
  const objectUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const widthCm = Number(customWidth.replace(",", "."));
  const heightCm = Number(customHeight.replace(",", "."));
  const sizeError =
    presetId === "custom" ? customSizeError(widthCm * 10, heightCm * 10) : null;

  const size = useMemo(
    () =>
      resolveQrCardSize({
        presetId,
        customWidthMm: widthCm * 10,
        customHeightMm: heightCm * 10,
        orientation,
      }),
    [presetId, widthCm, heightCm, orientation],
  );

  const background = useMemo<QrCardBackground>(
    () => ({
      mode: backgroundMode,
      image: backgroundImage,
      fit: backgroundFit,
      position: backgroundPosition,
      opacity: backgroundOpacity,
      soften,
    }),
    [backgroundMode, backgroundImage, backgroundFit, backgroundPosition, backgroundOpacity, soften],
  );

  const releaseObjectUrl = useCallback(() => {
    if (!objectUrl.current) return;
    URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  const firstCard = cards[0] ?? null;

  useEffect(() => {
    if (!open || !firstCard || sizeError) return;
    let cancelled = false;
    // A keystroke in the size field should not queue a full 300dpi render.
    const timer = window.setTimeout(() => {
      void renderQrCardDataUrl({
        tableName: firstCard.tableName,
        menuUrl: firstCard.menuUrl,
        size,
        dpi: (PREVIEW_WIDTH_PX / size.widthMm) * 25.4,
        background,
      })
        .then((dataUrl) => {
          if (!cancelled) setPreview(dataUrl);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, firstCard, size, background, sizeError]);

  function chooseBackground(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_BACKGROUND_BYTES) {
      toast.error("En fazla 10 MB boyutunda JPG, PNG veya WEBP görsel seçin.");
      return;
    }
    releaseObjectUrl();
    // Local only: the file never leaves the browser, so nothing is uploaded,
    // stored or attached to the restaurant.
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const image = new Image();
    image.onload = () => {
      setBackgroundImage(image);
      setBackgroundName(file.name);
      setBackgroundMode("image");
    };
    image.onerror = () => {
      releaseObjectUrl();
      toast.error("Görsel okunamadı.");
    };
    image.src = url;
  }

  function clearBackground() {
    releaseObjectUrl();
    setBackgroundImage(null);
    setBackgroundName(null);
    setBackgroundMode("none");
    if (fileInput.current) fileInput.current.value = "";
  }

  const renderAll = useCallback(
    () =>
      Promise.all(
        cards.map((card) =>
          renderQrCardDataUrl({
            tableName: card.tableName,
            menuUrl: card.menuUrl,
            size,
            dpi: QR_CARD_DEFAULT_DPI,
            background,
          }),
        ),
      ),
    [background, cards, size],
  );

  async function download() {
    if (!firstCard || sizeError) return;
    setBusy(true);
    try {
      const [dataUrl] = await renderAll();
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = qrCardFileName(restaurantName, firstCard.tableName);
      anchor.click();
    } catch {
      toast.error("QR kartı indirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    if (sizeError) return;
    setBusy(true);
    try {
      setPrintImages(await renderAll());
    } catch {
      toast.error("QR kartı yazdırılamadı.");
    } finally {
      setBusy(false);
    }
  }

  const pixels = qrCardPixelSize(size, QR_CARD_DEFAULT_DPI);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <WindowDialogContent
          size="xl"
          title="QR Baskı Ayarları"
          description={
            cards.length === 1 && firstCard
              ? `${firstCard.tableName} için baskı görünümünü hazırlayın.`
              : `${cards.length} masa için baskı görünümünü hazırlayın.`
          }
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              {cards.length === 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || Boolean(sizeError)}
                  onClick={() => void download()}
                >
                  <Download /> PNG İndir
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={busy || Boolean(sizeError)}
                aria-busy={busy}
                onClick={() => void print()}
              >
                <Printer /> Yazdır
              </Button>
            </>
          }
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
            <section aria-label="Önizleme" className="order-first lg:order-last">
              <p className="mb-2 text-xs font-extrabold text-muted-foreground">Önizleme</p>
              <div className="grid place-items-center rounded-xl border bg-muted/40 p-4">
                <div
                  className="w-full max-w-64 overflow-hidden rounded-md shadow-[var(--shadow-raised)]"
                  style={{ aspectRatio: `${size.widthMm} / ${size.heightMm}` }}
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a canvas data URL, not an asset
                    <img
                      src={preview}
                      alt="QR kartı önizlemesi"
                      className="block h-full w-full object-contain"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-card text-xs text-muted-foreground">
                      {sizeError ? "Boyutu düzeltin" : "Hazırlanıyor…"}
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {centimetres(size.widthMm)} × {centimetres(size.heightMm)} cm ·{" "}
                {pixels.width}×{pixels.height} px
              </p>
            </section>

            <section aria-label="Ayarlar" className="space-y-4">
              <Field label="Boyut">
                <NativeSelect
                  value={presetId}
                  onChange={(event) => setPresetId(event.target.value as QrCardPresetId)}
                  className="h-10"
                >
                  {QR_CARD_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label} — {centimetres(preset.widthMm)} × {centimetres(preset.heightMm)} cm
                    </option>
                  ))}
                  <option value="custom">Özel Boyut</option>
                </NativeSelect>
              </Field>

              {presetId === "custom" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Genişlik (cm)">
                    <Input
                      inputMode="decimal"
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                      className="h-10"
                      aria-invalid={Boolean(sizeError)}
                    />
                  </Field>
                  <Field label="Yükseklik (cm)">
                    <Input
                      inputMode="decimal"
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                      className="h-10"
                      aria-invalid={Boolean(sizeError)}
                    />
                  </Field>
                  {sizeError ? (
                    <p role="alert" className="col-span-2 text-xs font-bold text-destructive">
                      {sizeError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <Field label="Yön">
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["portrait", "Dikey"],
                      ["landscape", "Yatay"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={orientation === value ? "default" : "outline"}
                      onClick={() => setOrientation(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </Field>

              <Field label="Arka Plan">
                <NativeSelect
                  value={backgroundMode}
                  onChange={(event) => {
                    const next = event.target.value as QrCardBackgroundMode;
                    if (next === "image" && !backgroundImage) {
                      fileInput.current?.click();
                      return;
                    }
                    setBackgroundMode(next);
                  }}
                  className="h-10"
                >
                  <option value="none">Arka Plan Yok</option>
                  <option value="cream">Düz Krem</option>
                  <option value="image">Özel Görsel</option>
                </NativeSelect>
              </Field>

              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => chooseBackground(event.target.files?.[0])}
              />

              {backgroundMode === "image" ? (
                <div className="space-y-4 rounded-xl border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="bg-card"
                      onClick={() => fileInput.current?.click()}
                    >
                      <ImagePlus /> Görsel Seç
                    </Button>
                    {backgroundName ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {backgroundName}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label="Görseli kaldır"
                          onClick={clearBackground}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </div>

                  <Field label="Görsel Yerleşimi">
                    <NativeSelect
                      value={backgroundFit}
                      onChange={(event) =>
                        setBackgroundFit(event.target.value as QrCardBackgroundFit)
                      }
                      className="h-10"
                    >
                      <option value="cover">Doldur</option>
                      <option value="contain">Sığdır</option>
                    </NativeSelect>
                  </Field>

                  <Field label="Pozisyon">
                    <NativeSelect
                      value={backgroundPosition}
                      onChange={(event) =>
                        setBackgroundPosition(event.target.value as QrCardBackgroundPosition)
                      }
                      className="h-10"
                    >
                      <option value="center">Ortala</option>
                      <option value="top">Üst</option>
                      <option value="bottom">Alt</option>
                    </NativeSelect>
                  </Field>

                  <Field label={`Arka Plan Yoğunluğu — %${backgroundOpacity}`}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundOpacity}
                      onChange={(event) => setBackgroundOpacity(Number(event.target.value))}
                      className="h-10 w-full accent-burgundy"
                      aria-label="Arka plan yoğunluğu"
                    />
                  </Field>

                  <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-bold">
                    <span>Arka Plan Yumuşatma</span>
                    <input
                      type="checkbox"
                      checked={soften}
                      onChange={(event) => setSoften(event.target.checked)}
                      className="size-4 accent-burgundy"
                    />
                  </label>
                </div>
              ) : null}
            </section>
          </div>
        </WindowDialogContent>
      </Dialog>

      <QrPrintSheet
        images={printImages}
        widthMm={size.widthMm}
        heightMm={size.heightMm}
        onDone={() => setPrintImages([])}
      />
    </>
  );
}
