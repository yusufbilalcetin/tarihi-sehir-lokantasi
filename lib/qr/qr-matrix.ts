import qrcode from "qrcode-generator";

/**
 * The module grid behind every branded table code.
 *
 * Kept apart from the components that draw it so the SVG on screen, the PNG
 * that gets downloaded and printed, and the tests all read the same matrix
 * rather than three encoders that agree by luck.
 */

/**
 * The highest level the format defines: roughly 30% of the code may be lost
 * and still recover. The brand mark in the middle spends a small, measured
 * part of that budget — see {@link logoModuleSpan}.
 */
export const QR_ERROR_CORRECTION_LEVEL = "H" as const;

/** The specification's minimum silent border, in modules. */
export const QR_QUIET_ZONE_MODULES = 4;

/**
 * Brand mark width as a fraction of the code's own width. Held under a fifth
 * so the occluded area (this squared, about 2.5%) stays far inside the
 * correction budget; branding never buys itself a scan failure.
 */
export const QR_LOGO_WIDTH_RATIO = 0.16;

/** Near-black espresso on ivory. Contrast first: burgundy is too light here. */
export const QR_DARK_COLOR = "#241F1A";
export const QR_LIGHT_COLOR = "#FFFDF8";

export interface QrMatrix {
  readonly modules: readonly (readonly boolean[])[];
  readonly moduleCount: number;
  /** Module count including the quiet zone on both sides. */
  readonly canvasModules: number;
}

export function buildQrMatrix(payload: string): QrMatrix {
  if (!payload) throw new Error("QR payload is empty.");
  // Type 0 lets the encoder pick the smallest version that fits at level H.
  const code = qrcode(0, QR_ERROR_CORRECTION_LEVEL);
  code.addData(payload, "Byte");
  code.make();

  const moduleCount = code.getModuleCount();
  const modules = Array.from({ length: moduleCount }, (_, row) =>
    Array.from({ length: moduleCount }, (_, column) => code.isDark(row, column)),
  );
  return {
    modules,
    moduleCount,
    canvasModules: moduleCount + QR_QUIET_ZONE_MODULES * 2,
  };
}

/**
 * Brand mark width in modules, forced odd so it sits centred on the grid
 * instead of straddling a module boundary and clipping an extra row.
 */
export function logoModuleSpan(moduleCount: number): number {
  const span = Math.max(1, Math.round(moduleCount * QR_LOGO_WIDTH_RATIO));
  return span % 2 === 1 ? span : span + 1;
}

/** Share of the code's modules the brand mark covers. Compared against 0.30. */
export function logoCoverageRatio(moduleCount: number): number {
  return logoModuleSpan(moduleCount) ** 2 / moduleCount ** 2;
}

/**
 * Whole pixels per module, because a fractional module rounds differently row
 * to row and blurs the edge a scanner reads.
 *
 * Rounded rather than floored: flooring threw away up to a whole module across
 * the code, which at print sizes cost several millimetres off the size that was
 * asked for. Rounding lands within half a module either way, and the plate's
 * padding absorbs the half that goes outwards.
 */
export function qrModulePixels(availablePx: number, canvasModules: number): number {
  return Math.max(1, Math.round(availablePx / canvasModules));
}
