import {
  QR_CARD_BRAND,
  QR_CARD_DEFAULT_DPI,
  mmToPx,
  qrCardLayout,
  type QrCardLayout,
  type QrCardSize,
} from "./qr-card-layout";
import {
  QR_DARK_COLOR,
  QR_LIGHT_COLOR,
  QR_QUIET_ZONE_MODULES,
  buildQrMatrix,
  logoModuleSpan,
  qrModulePixels,
} from "./qr-matrix";

/**
 * The printable table card.
 *
 * A code on its own is a technical square; what goes on a table is a card that
 * says whose restaurant it is, which table it is and what to do with it. One
 * canvas draws that card and the preview, the download and the sheet handed to
 * the printer are the same drawing at three resolutions — so what the
 * administrator approves on screen is what comes out of the printer, and a
 * chosen background is baked into the output rather than left to a browser
 * that may decline to print background graphics at all.
 */

const IVORY = "#FBF6EC";
const CREAM = "#F1E7D5";
const PAPER = "#FFFDF8";
const ESPRESSO = "#241F1A";
const BURGUNDY = "#681F27";
const GOLD = "#C29B5B";
const MUTED = "#6E6259";

/**
 * The ivory veil that keeps a busy photograph from swallowing the words.
 *
 * It thickens with the strength the administrator asked for, so the slider
 * still does something at every setting while the photograph can never take
 * more than about a third of the final ground. A card whose table number
 * cannot be read at a glance has failed at the only job it has.
 */
function overlayAlpha(opacity: number): number {
  return 0.18 + 0.45 * (opacity / 100);
}

export type QrCardBackgroundMode = "none" | "cream" | "image";
export type QrCardBackgroundFit = "cover" | "contain";
export type QrCardBackgroundPosition = "center" | "top" | "bottom";

export interface QrCardBackground {
  readonly mode: QrCardBackgroundMode;
  /** Already decoded by the caller; this module never fetches. */
  readonly image?: CanvasImageSource | null;
  readonly fit?: QrCardBackgroundFit;
  readonly position?: QrCardBackgroundPosition;
  /** 0–100. How strongly the photograph shows through the ivory. */
  readonly opacity?: number;
  readonly soften?: boolean;
}

export interface QrCardOptions {
  readonly tableName: string;
  readonly menuUrl: string;
  readonly size: QrCardSize;
  readonly dpi?: number;
  readonly background?: QrCardBackground;
}

function cssFont(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value ? `${value}, ${fallback}` : fallback;
}

function headingFont(): string {
  return cssFont("--font-lora", '"Noto Serif", "Times New Roman", serif');
}

function bodyFont(): string {
  return cssFont("--font-manrope", 'system-ui, "Segoe UI", Arial, sans-serif');
}

function roundedRect(
  context: CanvasRenderingContext2D,
  { x, y, width, height }: { x: number; y: number; width: number; height: number },
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function setTracking(context: CanvasRenderingContext2D, pixels: number): void {
  try {
    context.letterSpacing = `${pixels}px`;
  } catch {
    // Engines without letterSpacing simply draw it untracked.
  }
}

/** Shrinks the font until the line fits, rather than letting it run off the card. */
function fitFont(
  context: CanvasRenderingContext2D,
  text: string,
  font: (size: number) => string,
  size: number,
  maxWidth: number,
): number {
  let candidate = size;
  context.font = font(candidate);
  while (candidate > 4 && context.measureText(text).width > maxWidth) {
    candidate *= 0.94;
    context.font = font(candidate);
  }
  return candidate;
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawParagraph(
  context: CanvasRenderingContext2D,
  text: string,
  block: { centerX: number; topY: number; fontSize: number; lineHeight: number; maxWidth: number },
  font: string,
  color: string,
  weight: string,
): void {
  context.font = `${weight} ${block.fontSize}px ${font}`;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "top";
  wrapLines(context, text, block.maxWidth).forEach((line, index) => {
    context.fillText(line, block.centerX, block.topY + index * block.lineHeight);
  });
}

/**
 * Paints the ground.
 *
 * Whatever the administrator chose, the card ends up light: the photograph is
 * drawn at the requested strength and then an ivory veil goes over it, so the
 * wordmark and the table name never have to compete with a dark corner of
 * someone's dining-room photo.
 */
function drawBackground(
  context: CanvasRenderingContext2D,
  layout: QrCardLayout,
  background: QrCardBackground | undefined,
): void {
  const mode = background?.mode ?? "none";
  context.fillStyle = mode === "cream" ? CREAM : IVORY;
  context.fillRect(0, 0, layout.widthPx, layout.heightPx);
  if (mode !== "image" || !background?.image) return;

  const source = background.image;
  const naturalWidth =
    source instanceof HTMLImageElement ? source.naturalWidth : (source as HTMLCanvasElement).width;
  const naturalHeight =
    source instanceof HTMLImageElement ? source.naturalHeight : (source as HTMLCanvasElement).height;
  if (!naturalWidth || !naturalHeight) return;

  const scale =
    background.fit === "contain"
      ? Math.min(layout.widthPx / naturalWidth, layout.heightPx / naturalHeight)
      : Math.max(layout.widthPx / naturalWidth, layout.heightPx / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  const x = (layout.widthPx - drawWidth) / 2;
  const y =
    background.position === "top"
      ? 0
      : background.position === "bottom"
        ? layout.heightPx - drawHeight
        : (layout.heightPx - drawHeight) / 2;

  const opacity = Math.min(100, Math.max(0, background.opacity ?? 25));
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.globalAlpha = opacity / 100;
  if (background.soften) {
    // Deliberately gentle: anything heavier reads as a printing fault rather
    // than as depth, and it costs real detail at 300dpi.
    context.filter = `blur(${mmToPx(0.35, layout.dpi)}px)`;
  }
  context.drawImage(source, x, y, drawWidth, drawHeight);
  context.restore();

  context.fillStyle = IVORY;
  context.globalAlpha = overlayAlpha(opacity);
  context.fillRect(0, 0, layout.widthPx, layout.heightPx);
  context.globalAlpha = 1;
}

/** The stacked brand inside the code, which is why it is never a single letter. */
function drawCompactMark(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  span: number,
): void {
  const lines = QR_CARD_BRAND.compact;
  const font = (size: number) => `600 ${size}px ${headingFont()}`;
  const inner = span * 0.78;
  // The longest word decides the size, so all three stay on one line each.
  const longest = lines.reduce((a, b) => (a.length >= b.length ? a : b));
  const fontSize = fitFont(context, longest, font, inner / 3.1, inner);

  context.font = font(fontSize);
  context.fillStyle = BURGUNDY;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lineHeight = fontSize * 1.12;
  const top = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, centerX, top + index * lineHeight);
  });
}

function drawQr(
  context: CanvasRenderingContext2D,
  menuUrl: string,
  layout: QrCardLayout,
): void {
  const matrix = buildQrMatrix(menuUrl);
  const modulePixels = qrModulePixels(layout.qr.width, matrix.canvasModules);
  const drawnSide = modulePixels * matrix.canvasModules;
  const originX = Math.round(layout.qr.x + (layout.qr.width - drawnSide) / 2);
  const originY = Math.round(layout.qr.y + (layout.qr.height - drawnSide) / 2);

  // The plate is opaque, always: whatever the card's background is, the code
  // sits on its own light ground and no texture reaches its modules.
  context.fillStyle = PAPER;
  context.strokeStyle = GOLD;
  context.lineWidth = Math.max(1, mmToPx(0.25, layout.dpi));
  roundedRect(context, layout.qrPlate, layout.qrPlateRadius);
  context.fill();
  context.stroke();

  context.save();
  // Crisp module edges are worth more than smoothing here.
  context.imageSmoothingEnabled = false;
  context.fillStyle = QR_LIGHT_COLOR;
  context.fillRect(originX, originY, drawnSide, drawnSide);
  context.fillStyle = QR_DARK_COLOR;
  for (let row = 0; row < matrix.moduleCount; row += 1) {
    for (let column = 0; column < matrix.moduleCount; column += 1) {
      if (!matrix.modules[row][column]) continue;
      context.fillRect(
        originX + (column + QR_QUIET_ZONE_MODULES) * modulePixels,
        originY + (row + QR_QUIET_ZONE_MODULES) * modulePixels,
        modulePixels,
        modulePixels,
      );
    }
  }
  context.restore();

  const span = logoModuleSpan(matrix.moduleCount) * modulePixels;
  const markX = originX + drawnSide / 2;
  const markY = originY + drawnSide / 2;
  context.fillStyle = PAPER;
  context.strokeStyle = GOLD;
  context.lineWidth = Math.max(1, span * 0.05);
  roundedRect(
    context,
    { x: markX - span / 2, y: markY - span / 2, width: span, height: span },
    span * 0.14,
  );
  context.fill();
  context.stroke();
  drawCompactMark(context, markX, markY, span);
}

function drawWordmark(context: CanvasRenderingContext2D, layout: QrCardLayout): void {
  const { wordmark } = layout;
  const font = (size: number) => `600 ${size}px ${headingFont()}`;

  setTracking(context, wordmark.tracking);
  const fontSize = fitFont(
    context,
    QR_CARD_BRAND.wordmark,
    font,
    wordmark.fontSize,
    wordmark.maxWidth * 0.92,
  );
  context.font = font(fontSize);
  context.fillStyle = GOLD;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(QR_CARD_BRAND.wordmark, wordmark.centerX, wordmark.centerY);
  setTracking(context, 0);

  // Two hairlines and nothing else. The reference is a restaurant's own
  // stationery, not an ornament catalogue.
  context.strokeStyle = GOLD;
  context.lineWidth = Math.max(1, mmToPx(0.2, layout.dpi));
  for (const offset of [-wordmark.ruleOffset, wordmark.ruleOffset]) {
    context.beginPath();
    context.moveTo(wordmark.centerX - wordmark.ruleWidth / 2, wordmark.centerY + offset);
    context.lineTo(wordmark.centerX + wordmark.ruleWidth / 2, wordmark.centerY + offset);
    context.stroke();
  }
}

export function renderQrCardTo(
  canvas: HTMLCanvasElement,
  options: QrCardOptions,
): HTMLCanvasElement {
  const dpi = options.dpi ?? QR_CARD_DEFAULT_DPI;
  const layout = qrCardLayout(options.size, dpi);
  canvas.width = layout.widthPx;
  canvas.height = layout.heightPx;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("QR kartı çizilemedi.");

  drawBackground(context, layout, options.background);

  context.strokeStyle = BURGUNDY;
  context.lineWidth = layout.border.outerWidth;
  roundedRect(context, layout.border.outer, layout.border.outerRadius);
  context.stroke();

  context.strokeStyle = GOLD;
  context.lineWidth = layout.border.innerWidth;
  roundedRect(context, layout.border.inner, layout.border.innerRadius);
  context.stroke();

  drawWordmark(context, layout);
  drawQr(context, options.menuUrl, layout);

  const heading = headingFont();
  const tableText = options.tableName.toLocaleUpperCase("tr-TR");
  setTracking(context, layout.tableName.tracking);
  const tableFont = (size: number) => `600 ${size}px ${heading}`;
  const tableSize = fitFont(
    context,
    tableText,
    tableFont,
    layout.tableName.fontSize,
    layout.tableName.maxWidth,
  );
  context.font = tableFont(tableSize);
  context.fillStyle = ESPRESSO;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(tableText, layout.tableName.centerX, layout.tableName.baselineY);
  setTracking(context, 0);

  const body = bodyFont();
  drawParagraph(context, QR_CARD_BRAND.instruction, layout.instruction, body, BURGUNDY, "600");
  drawParagraph(context, QR_CARD_BRAND.note, layout.note, body, MUTED, "400");

  return canvas;
}

export async function renderQrCardDataUrl(options: QrCardOptions): Promise<string> {
  // Web fonts decide the glyphs, so the card waits for them rather than baking
  // a fallback serif into a printed asset.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  return renderQrCardTo(document.createElement("canvas"), options).toDataURL("image/png");
}

/** `tarihi-sehir-lokantasi-masa-4-qr.png`, from the names on the card. */
export function qrCardFileName(restaurantName: string, tableName: string): string {
  const slug = (value: string) =>
    value
      .toLocaleLowerCase("tr-TR")
      .replaceAll("ı", "i")
      .replaceAll("ş", "s")
      .replaceAll("ğ", "g")
      .replaceAll("ü", "u")
      .replaceAll("ö", "o")
      .replaceAll("ç", "c")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${slug(restaurantName)}-${slug(tableName)}-qr.png`;
}
