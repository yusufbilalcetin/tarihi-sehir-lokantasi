export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSION_BY_MIME = {
  "image/avif": "avif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type SupportedImageMimeType = keyof typeof IMAGE_EXTENSION_BY_MIME;

/** Enough for a PNG signature, a RIFF/WebP header and an AVIF `ftyp` box. */
export const IMAGE_SIGNATURE_BYTES = 64;

export interface ImageUploadMetadata {
  mimeType: string;
  byteLength: number;
  /** First `IMAGE_SIGNATURE_BYTES` of the upload; the only trusted type source. */
  header: Uint8Array;
}

export type ImageUploadValidation =
  | { valid: true; extension: string; mimeType: SupportedImageMimeType }
  | {
      valid: false;
      code:
        | "UNSUPPORTED_IMAGE_TYPE"
        | "IMAGE_TOO_LARGE"
        | "EMPTY_IMAGE"
        | "IMAGE_CONTENT_MISMATCH";
    };

function hasAscii(header: Uint8Array, offset: number, ascii: string): boolean {
  if (header.length < offset + ascii.length) return false;
  for (let index = 0; index < ascii.length; index += 1) {
    if (header[offset + index] !== ascii.charCodeAt(index)) return false;
  }
  return true;
}

function startsWith(header: Uint8Array, bytes: readonly number[]): boolean {
  if (header.length < bytes.length) return false;
  return bytes.every((byte, index) => header[index] === byte);
}

/**
 * An ISO-BMFF `ftyp` box lists a major brand and then compatible brands. Real
 * encoders ship AVIF files whose major brand is `mif1`, with `avif` appearing
 * only in the compatible list, so both positions are checked.
 */
function isAvif(header: Uint8Array): boolean {
  if (!hasAscii(header, 4, "ftyp")) return false;
  const declaredSize = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  ).getUint32(0);
  const boxEnd = Math.min(
    header.length,
    declaredSize >= 16 ? declaredSize : header.length,
  );
  for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
    if (hasAscii(header, offset, "avif") || hasAscii(header, offset, "avis")) return true;
  }
  return false;
}

/** Reads the real container type from the bytes, ignoring any declared value. */
export function detectImageMimeType(header: Uint8Array): SupportedImageMimeType | null {
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasAscii(header, 0, "RIFF") && hasAscii(header, 8, "WEBP")) return "image/webp";
  if (isAvif(header)) return "image/avif";
  return null;
}

/**
 * `Content-Type` and the filename are attacker-supplied, so neither decides what
 * gets stored. The signature does, and a declared type that disagrees with the
 * bytes is refused rather than silently corrected.
 */
export function validateProductImageUpload(
  metadata: ImageUploadMetadata,
): ImageUploadValidation {
  if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 1) {
    return { valid: false, code: "EMPTY_IMAGE" };
  }
  if (metadata.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    return { valid: false, code: "IMAGE_TOO_LARGE" };
  }
  if (!IMAGE_EXTENSION_BY_MIME[metadata.mimeType as SupportedImageMimeType]) {
    return { valid: false, code: "UNSUPPORTED_IMAGE_TYPE" };
  }

  const detected = detectImageMimeType(metadata.header);
  if (!detected) return { valid: false, code: "UNSUPPORTED_IMAGE_TYPE" };
  if (detected !== metadata.mimeType) {
    return { valid: false, code: "IMAGE_CONTENT_MISMATCH" };
  }

  return { valid: true, extension: IMAGE_EXTENSION_BY_MIME[detected], mimeType: detected };
}

function storageSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error(`${label} has an invalid storage identifier.`);
  }
  return value;
}

/** Stable path without user-controlled filenames. */
export function productImagePath(
  restaurantId: string,
  productId: string,
  extension: string,
): string {
  const normalizedExtension = extension.toLowerCase();
  if (!["avif", "jpg", "png", "webp"].includes(normalizedExtension)) {
    throw new Error("Product image extension is not supported.");
  }
  return `${storageSegment(restaurantId, "Restaurant")}/products/${storageSegment(
    productId,
    "Product",
  )}/original.${normalizedExtension}`;
}
