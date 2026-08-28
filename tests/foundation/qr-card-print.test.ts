import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  QR_CARD_BRAND,
  QR_CARD_DEFAULT_DPI,
  QR_CARD_DEFAULT_PRESET,
  QR_CARD_MAX_MM,
  QR_CARD_MIN_MM,
  QR_CARD_PRESETS,
  customSizeError,
  qrCardLayout,
  qrCardPixelSize,
  resolveQrCardSize,
  type QrCardOrientation,
  type QrCardPresetId,
} from "../../lib/qr/qr-card-layout";
import { buildQrMatrix, qrModulePixels } from "../../lib/qr/qr-matrix";

function size(
  presetId: QrCardPresetId,
  orientation: QrCardOrientation = "portrait",
  custom?: { widthMm: number; heightMm: number },
) {
  return resolveQrCardSize({
    presetId,
    orientation,
    customWidthMm: custom?.widthMm,
    customHeightMm: custom?.heightMm,
  });
}

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the default table card is 10 x 15 cm, portrait", () => {
  assert.equal(QR_CARD_DEFAULT_PRESET, "standard");
  const standard = size("standard");
  assert.equal(standard.widthMm, 100);
  assert.equal(standard.heightMm, 150);
  assert.equal(standard.qrMm, 72);
});

test("every preset prints at its stated physical size", () => {
  assert.deepEqual(
    QR_CARD_PRESETS.map((preset) => [preset.id, preset.widthMm, preset.heightMm]),
    [
      ["standard", 100, 150],
      ["compact", 80, 120],
      ["a6", 105, 148],
      ["large", 130, 180],
    ],
  );
});

test("landscape swaps the page and keeps the code sized to the short edge", () => {
  for (const preset of QR_CARD_PRESETS) {
    const portrait = size(preset.id);
    const landscape = size(preset.id, "landscape");
    assert.equal(landscape.widthMm, portrait.heightMm, preset.id);
    assert.equal(landscape.heightMm, portrait.widthMm, preset.id);
    assert.equal(landscape.qrMm, portrait.qrMm, preset.id);
  }
});

test("the code takes the share of the card each size was given", () => {
  // Bands from the print brief: bigger cards get a bigger code, but not
  // proportionally bigger, or a large card becomes all code.
  const bands: Record<string, readonly [number, number]> = {
    compact: [58, 62],
    standard: [70, 76],
    a6: [72, 78],
    large: [82, 90],
  };
  for (const preset of QR_CARD_PRESETS) {
    const [low, high] = bands[preset.id];
    assert.ok(preset.qrMm >= low && preset.qrMm <= high, `${preset.id}: ${preset.qrMm}mm`);
  }
  // A custom card lands in the same neighbourhood, about seven tenths across.
  const custom = size("custom", "portrait", { widthMm: 90, heightMm: 140 });
  const ratio = custom.qrMm / Math.min(custom.widthMm, custom.heightMm);
  assert.ok(ratio >= 0.65 && ratio <= 0.72, `custom ratio ${ratio}`);
});

test("a custom size is taken in centimetres and held inside the printable range", () => {
  const custom = size("custom", "portrait", { widthMm: 90, heightMm: 140 });
  assert.equal(custom.widthMm, 90);
  assert.equal(custom.heightMm, 140);

  assert.equal(customSizeError(100, 150), null);
  assert.equal(customSizeError(QR_CARD_MIN_MM, QR_CARD_MAX_MM), null);
  const message = "Boyut 7–30 cm arasında olmalıdır.";
  assert.equal(customSizeError(69, 150), message);
  assert.equal(customSizeError(100, 301), message);
  assert.equal(customSizeError(Number.NaN, 150), message);

  // Out-of-range values never reach the renderer even if the field is bypassed.
  const clamped = size("custom", "portrait", { widthMm: 5, heightMm: 900 });
  assert.equal(clamped.widthMm, QR_CARD_MIN_MM);
  assert.equal(clamped.heightMm, QR_CARD_MAX_MM);
});

test("the download is print resolution at 300 dpi", () => {
  assert.equal(QR_CARD_DEFAULT_DPI, 300);
  assert.deepEqual(qrCardPixelSize(size("standard"), 300), { width: 1_181, height: 1_772 });
  assert.deepEqual(qrCardPixelSize(size("a6"), 300), { width: 1_240, height: 1_748 });
  assert.deepEqual(qrCardPixelSize(size("compact"), 300), { width: 945, height: 1_417 });
  assert.deepEqual(qrCardPixelSize(size("standard", "landscape"), 300), {
    width: 1_772,
    height: 1_181,
  });
});

test("the code keeps its plate inside the card at every size and orientation", () => {
  for (const presetId of [...QR_CARD_PRESETS.map((p) => p.id), "custom" as const]) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const card = size(presetId, orientation, { widthMm: 90, heightMm: 140 });
      const layout = qrCardLayout(card, 300);
      const label = `${presetId}/${orientation}`;

      assert.ok(layout.qrPlate.x >= 0, label);
      assert.ok(layout.qrPlate.y >= 0, label);
      assert.ok(layout.qrPlate.x + layout.qrPlate.width <= layout.widthPx + 1, label);
      assert.ok(layout.qrPlate.y + layout.qrPlate.height <= layout.heightPx + 1, label);
      // The code sits strictly inside its own light plate, so no card
      // background can ever touch a module.
      assert.ok(layout.qr.x > layout.qrPlate.x, label);
      assert.ok(
        layout.qr.x + layout.qr.width < layout.qrPlate.x + layout.qrPlate.width,
        label,
      );
      // And the last line of copy still lands on the card.
      assert.ok(layout.note.topY + layout.note.lineHeight * 2 <= layout.heightPx, label);
    }
  }
});

test("even a landscape card keeps a code big enough to scan", () => {
  const layout = qrCardLayout(size("standard", "landscape"), 300);
  const qrMm = (layout.qr.width / 300) * 25.4;
  // 61 modules across 40mm is still ~0.65mm per module — comfortably above the
  // point where a phone camera starts to struggle.
  assert.ok(qrMm >= 40, `landscape code is ${qrMm.toFixed(1)}mm`);
});

test("the background changes the card and never the code", () => {
  const menuUrl = "https://tarihi-sehir-lokantasi.vercel.app/menu/l1.tarihi-sehir-lokantasi.4.PLACEHOLDERPLACEHOLDERPLACEHOLDERPLACEHOLD";
  // The matrix is a function of the address alone.
  assert.deepEqual(buildQrMatrix(menuUrl).modules, buildQrMatrix(menuUrl).modules);
  // Layout takes size and resolution — background is not one of its inputs, so
  // it cannot move a module even in principle.
  assert.deepEqual(qrCardLayout(size("standard"), 300), qrCardLayout(size("standard"), 300));

  // And the renderer only ever encodes the menu address.
  const canvas = read("lib/qr/qr-card-canvas.ts");
  const calls = canvas.match(/buildQrMatrix\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ["buildQrMatrix(menuUrl)"]);
  // The plate under the code is opaque, drawn after the background.
  assert.ok(canvas.indexOf("function drawBackground") < canvas.indexOf("function drawQr"));
});

test("the printed brand is the restaurant's name, never a lone initial", () => {
  assert.equal(QR_CARD_BRAND.wordmark, "ESKİ ŞEHİR LOKANTASI");
  assert.deepEqual([...QR_CARD_BRAND.compact], ["ESKİ", "ŞEHİR", "LOKANTASI"]);

  for (const source of [
    read("lib/qr/qr-card-canvas.ts"),
    read("components/shared/branded-table-qr.tsx"),
  ]) {
    // A single-letter monogram in the middle of the code is exactly what this
    // replaced; it must not creep back as a "simpler" mark.
    assert.doesNotMatch(source, /["'>]\s*[ŞS]\s*["'<]/);
  }
});

test("the print sheet states a real page size and the stylesheet does not override it", () => {
  const sheet = read("components/admin/qr-print-sheet.tsx");
  assert.match(sheet, /@page \{ size: \$\{widthMm\}mm \$\{heightMm\}mm; margin: 0 \}/);
  assert.match(sheet, /width: `\$\{widthMm\}mm`/);
  assert.match(sheet, /pageStyle\.remove\(\)/);

  const css = read("app/globals.css");
  const printBlock = css.slice(css.indexOf("#qr-print-root img"));
  assert.doesNotMatch(printBlock.slice(0, 200), /width:\s*\d/);
});

test("a background file is accepted only as a bounded raster image", () => {
  const designer = read("components/admin/qr-print-designer.tsx");
  assert.match(designer, /image\/jpeg/);
  assert.match(designer, /image\/png/);
  assert.match(designer, /image\/webp/);
  // SVG is a script container, so it is not on the list.
  assert.doesNotMatch(designer, /image\/svg/);
  assert.match(designer, /10 \* 1024 \* 1024/);
  assert.match(designer, /En fazla 10 MB boyutunda JPG, PNG veya WEBP görsel seçin\./);
  // Local only, and the object URL is released rather than leaked.
  assert.match(designer, /URL\.revokeObjectURL/);
  assert.doesNotMatch(designer, /fetch\(|FormData|XMLHttpRequest|apiRequest|adminApi/);
});

test("the printed code really is the size the card promised", () => {
  const menuUrl =
    "https://tarihi-sehir-lokantasi.vercel.app/menu/l1.tarihi-sehir-lokantasi.4.PLACEHOLDERPLACEHOLDERPLACEHOLDERPLACEHOLD";
  const matrix = buildQrMatrix(menuUrl);
  // Same bands as the brief. Modules have to land on whole pixels, so the
  // drawn size steps rather than matching exactly — it must still step inside
  // the band, which flooring did not (a compact card came out at 55mm).
  const bands: Record<string, readonly [number, number]> = {
    compact: [58, 62.5],
    standard: [70, 76],
    a6: [72, 78],
    large: [82, 90],
  };

  for (const preset of QR_CARD_PRESETS) {
    const layout = qrCardLayout(size(preset.id), 300);
    const drawnMm =
      (qrModulePixels(layout.qr.width, matrix.canvasModules) * matrix.canvasModules * 25.4) / 300;
    const [low, high] = bands[preset.id];
    assert.ok(
      drawnMm >= low && drawnMm <= high,
      `${preset.id}: asked ${preset.qrMm}mm, drew ${drawnMm.toFixed(1)}mm`,
    );
    // And it still fits inside its own plate, whatever the rounding did.
    assert.ok(drawnMm < (layout.qrPlate.width * 25.4) / 300, preset.id);
  }
});
