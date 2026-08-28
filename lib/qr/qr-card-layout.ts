/**
 * Where everything sits on a printed table card, in millimetres.
 *
 * Kept pure and free of the canvas so the geometry can be tested without a
 * browser, and so the on-screen preview, the PNG download and the sheet that
 * goes to the printer are all the same arithmetic at three different
 * resolutions rather than three layouts that happen to agree.
 *
 * Millimetres, not pixels, because this object ends up glued to a table: the
 * card has a real size, and the pixel count is only how finely that size is
 * sampled.
 */

export const MM_PER_INCH = 25.4;
export const QR_CARD_DEFAULT_DPI = 300;

/** A card smaller than this cannot hold a scannable code and a table name. */
export const QR_CARD_MIN_MM = 70;
/** Beyond this it is a poster, not a table card. */
export const QR_CARD_MAX_MM = 300;

/**
 * The brand as it appears on the printed card.
 *
 * Presentation only, and deliberately its own constant: the restaurant's name
 * in the database, in the customer menu and in every report is whatever the
 * row says, and a preference about what a printed card should read must not
 * quietly rewrite the business's identity everywhere else.
 */
export const QR_CARD_BRAND = {
  /** The full wordmark across the top of the card. */
  wordmark: "ESKİ ŞEHİR LOKANTASI",
  /**
   * The same name inside the code, stacked because the horizontal wordmark
   * would be far too wide for the small island the correction budget allows.
   */
  compact: ["ESKİ", "ŞEHİR", "LOKANTASI"],
  instruction: "Menüyü görüntülemek için QR kodunu okutun.",
  note: "Siparişinizi telefonunuzdan verebilirsiniz.",
} as const;

export type QrCardPresetId = "compact" | "standard" | "a6" | "large" | "custom";
export type QrCardOrientation = "portrait" | "landscape";

export interface QrCardPreset {
  readonly id: Exclude<QrCardPresetId, "custom">;
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
  /**
   * The code's own printed width, quiet zone included. Chosen per size rather
   * than as one ratio: a bigger card wants a bigger code, but not
   * proportionally bigger, or a large card becomes all code.
   */
  readonly qrMm: number;
}

export const QR_CARD_PRESETS: readonly QrCardPreset[] = [
  { id: "standard", label: "Standart Masa Kartı", widthMm: 100, heightMm: 150, qrMm: 72 },
  { id: "compact", label: "Kompakt", widthMm: 80, heightMm: 120, qrMm: 60 },
  { id: "a6", label: "A6", widthMm: 105, heightMm: 148, qrMm: 75 },
  { id: "large", label: "Büyük Masa Kartı", widthMm: 130, heightMm: 180, qrMm: 86 },
];

export const QR_CARD_DEFAULT_PRESET: QrCardPresetId = "standard";

export interface QrCardSizeInput {
  readonly presetId: QrCardPresetId;
  readonly customWidthMm?: number;
  readonly customHeightMm?: number;
  readonly orientation: QrCardOrientation;
}

export interface QrCardSize {
  readonly widthMm: number;
  readonly heightMm: number;
  /** The code's printed width, quiet zone included. */
  readonly qrMm: number;
  readonly orientation: QrCardOrientation;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Turkish validation message for the custom size fields, or null when valid. */
export function customSizeError(widthMm: number, heightMm: number): string | null {
  const outOfRange = (value: number) =>
    !Number.isFinite(value) || value < QR_CARD_MIN_MM || value > QR_CARD_MAX_MM;
  return outOfRange(widthMm) || outOfRange(heightMm)
    ? `Boyut ${QR_CARD_MIN_MM / 10}–${QR_CARD_MAX_MM / 10} cm arasında olmalıdır.`
    : null;
}

export function resolveQrCardSize(input: QrCardSizeInput): QrCardSize {
  const preset =
    input.presetId === "custom"
      ? null
      : QR_CARD_PRESETS.find((item) => item.id === input.presetId) ?? QR_CARD_PRESETS[0];

  const portraitWidth = preset
    ? preset.widthMm
    : clamp(input.customWidthMm ?? 100, QR_CARD_MIN_MM, QR_CARD_MAX_MM);
  const portraitHeight = preset
    ? preset.heightMm
    : clamp(input.customHeightMm ?? 150, QR_CARD_MIN_MM, QR_CARD_MAX_MM);

  const landscape = input.orientation === "landscape";
  const widthMm = landscape ? portraitHeight : portraitWidth;
  const heightMm = landscape ? portraitWidth : portraitHeight;
  const shortEdge = Math.min(widthMm, heightMm);

  // A custom card gets roughly seven tenths of its short edge, which is where
  // the presets sit too.
  const requested = preset ? preset.qrMm : Math.round(shortEdge * 0.7);

  return { widthMm, heightMm, qrMm: requested, orientation: input.orientation };
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm * dpi) / MM_PER_INCH;
}

export function qrCardPixelSize(
  size: QrCardSize,
  dpi: number,
): { readonly width: number; readonly height: number } {
  return {
    width: Math.round(mmToPx(size.widthMm, dpi)),
    height: Math.round(mmToPx(size.heightMm, dpi)),
  };
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface QrCardLayout {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: number;
  readonly border: {
    readonly outer: Rect;
    readonly inner: Rect;
    readonly outerRadius: number;
    readonly innerRadius: number;
    readonly outerWidth: number;
    readonly innerWidth: number;
  };
  /** The light plate; the code never touches whatever is behind the card. */
  readonly qrPlate: Rect;
  readonly qrPlateRadius: number;
  /** The code itself, quiet zone included. */
  readonly qr: Rect;
  readonly wordmark: {
    readonly centerX: number;
    readonly centerY: number;
    readonly fontSize: number;
    readonly maxWidth: number;
    readonly ruleWidth: number;
    readonly ruleOffset: number;
    readonly tracking: number;
  };
  readonly tableName: {
    readonly centerX: number;
    readonly baselineY: number;
    readonly fontSize: number;
    readonly maxWidth: number;
    readonly tracking: number;
  };
  readonly instruction: {
    readonly centerX: number;
    readonly topY: number;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly maxWidth: number;
  };
  readonly note: {
    readonly centerX: number;
    readonly topY: number;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly maxWidth: number;
  };
}

/**
 * Places the blocks.
 *
 * Portrait stacks them down the middle. Landscape puts the code in the left
 * half and the words in the right, because a wide card that keeps stacking
 * ends up with a code shrunk to fit a short page — which is the one thing this
 * card cannot afford.
 */
export function qrCardLayout(size: QrCardSize, dpi: number): QrCardLayout {
  const px = (mm: number) => mmToPx(mm, dpi);
  const { widthMm, heightMm } = size;
  const shortEdge = Math.min(widthMm, heightMm);
  const landscape = widthMm > heightMm;

  const outerInset = shortEdge * 0.035;
  const innerInset = outerInset * 1.4;
  // The furniture around the code is budgeted, not chosen freely: whatever it
  // takes, the code has to come out at the size the preset promised, because
  // that is the number a restaurant checks against its stand.
  const pad = shortEdge * 0.07;

  const platePad = clamp(shortEdge * 0.05, 3.5, 7);
  const wordmarkHeight = clamp(shortEdge * 0.09, 6.5, 14);
  const tableHeight = clamp(shortEdge * 0.078, 5.5, 12);
  const instructionHeight = clamp(shortEdge * 0.042, 3, 5.4);
  const noteHeight = clamp(shortEdge * 0.034, 2.6, 4.4);
  const gapWordmark = shortEdge * 0.035;
  const gapQr = shortEdge * 0.042;
  const gapText = shortEdge * 0.026;
  const gapNote = shortEdge * 0.016;
  const lineFactor = 1.35;

  const contentWidth = widthMm - pad * 2;
  const contentHeight = heightMm - pad * 2;

  // The words wrap, so their block is measured in lines rather than assumed to
  // be one; two lines each is the worst case the narrow landscape column hits.
  const instructionLines = landscape ? 3 : 2;
  const noteLines = landscape ? 2 : 1;
  const instructionBlock = instructionHeight * lineFactor * instructionLines;
  const noteBlock = noteHeight * lineFactor * noteLines;

  let plateSide: number;
  let qrSide: number;
  let plateX: number;
  let plateY: number;
  let textCenterX: number;
  let textTop: number;
  let textWidth: number;
  let wordmarkCenterX: number;
  let wordmarkCenterY: number;
  let wordmarkWidth: number;

  if (landscape) {
    // The code takes the height it can get; the words take what is left across.
    plateSide = Math.min(contentHeight, contentWidth * 0.52);
    qrSide = Math.min(size.qrMm, plateSide - platePad * 2);
    plateSide = qrSide + platePad * 2;

    const columnGap = shortEdge * 0.07;
    plateX = pad;
    plateY = pad + (contentHeight - plateSide) / 2;

    textWidth = contentWidth - plateSide - columnGap;
    textCenterX = pad + plateSide + columnGap + textWidth / 2;
    wordmarkWidth = textWidth;
    wordmarkCenterX = textCenterX;

    const stack =
      wordmarkHeight +
      gapQr +
      tableHeight +
      gapText +
      instructionBlock +
      gapNote +
      noteBlock;
    const stackTop = pad + Math.max(0, (contentHeight - stack) / 2);
    wordmarkCenterY = stackTop + wordmarkHeight / 2;
    textTop = stackTop + wordmarkHeight + gapQr;
  } else {
    const fixed =
      wordmarkHeight +
      gapWordmark +
      gapQr +
      tableHeight +
      gapText +
      instructionBlock +
      gapNote +
      noteBlock;
    plateSide = Math.min(
      contentWidth,
      size.qrMm + platePad * 2,
      Math.max(contentHeight - fixed, shortEdge * 0.35),
    );
    qrSide = plateSide - platePad * 2;

    const stack = fixed + plateSide;
    const stackTop = pad + Math.max(0, (contentHeight - stack) / 2);

    wordmarkCenterX = widthMm / 2;
    wordmarkWidth = contentWidth;
    wordmarkCenterY = stackTop + wordmarkHeight / 2;

    plateX = (widthMm - plateSide) / 2;
    plateY = stackTop + wordmarkHeight + gapWordmark;

    textCenterX = widthMm / 2;
    textWidth = contentWidth;
    textTop = plateY + plateSide + gapQr;
  }

  const tableBaseline = textTop + tableHeight;
  const instructionTop = tableBaseline + gapText;
  const noteTop = instructionTop + instructionBlock + gapNote;

  return {
    widthPx: Math.round(px(widthMm)),
    heightPx: Math.round(px(heightMm)),
    dpi,
    border: {
      outer: {
        x: px(outerInset),
        y: px(outerInset),
        width: px(widthMm - outerInset * 2),
        height: px(heightMm - outerInset * 2),
      },
      inner: {
        x: px(innerInset),
        y: px(innerInset),
        width: px(widthMm - innerInset * 2),
        height: px(heightMm - innerInset * 2),
      },
      outerRadius: px(shortEdge * 0.022),
      innerRadius: px(shortEdge * 0.016),
      outerWidth: Math.max(1, px(0.35)),
      innerWidth: Math.max(1, px(0.15)),
    },
    qrPlate: {
      x: px(plateX),
      y: px(plateY),
      width: px(plateSide),
      height: px(plateSide),
    },
    qrPlateRadius: px(clamp(shortEdge * 0.035, 3, 4)),
    qr: {
      x: px(plateX + platePad),
      y: px(plateY + platePad),
      width: px(qrSide),
      height: px(qrSide),
    },
    wordmark: {
      centerX: px(wordmarkCenterX),
      centerY: px(wordmarkCenterY),
      fontSize: px(wordmarkHeight * 0.46),
      maxWidth: px(wordmarkWidth),
      ruleWidth: px(wordmarkWidth * (landscape ? 0.9 : 0.62)),
      ruleOffset: px(wordmarkHeight * 0.5),
      tracking: px(wordmarkHeight * 0.055),
    },
    tableName: {
      centerX: px(textCenterX),
      baselineY: px(tableBaseline),
      fontSize: px(tableHeight * 0.92),
      maxWidth: px(textWidth),
      tracking: px(tableHeight * 0.07),
    },
    instruction: {
      centerX: px(textCenterX),
      topY: px(instructionTop),
      fontSize: px(instructionHeight),
      lineHeight: px(instructionHeight * lineFactor),
      maxWidth: px(textWidth),
    },
    note: {
      centerX: px(textCenterX),
      topY: px(noteTop),
      fontSize: px(noteHeight),
      lineHeight: px(noteHeight * lineFactor),
      maxWidth: px(textWidth),
    },
  };
}
