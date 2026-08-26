import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  IMAGE_SIGNATURE_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  detectImageMimeType,
  productImagePath,
  validateProductImageUpload,
} from "../../lib/supabase/storage";

function header(...parts: readonly (number | string)[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") bytes.push(part);
    else for (const character of part) bytes.push(character.charCodeAt(0));
  }
  while (bytes.length < IMAGE_SIGNATURE_BYTES) bytes.push(0);
  return Uint8Array.from(bytes);
}

const JPEG = header(0xff, 0xd8, 0xff, 0xe0, "JFIF");
const PNG = header(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = header("RIFF", 0x24, 0x00, 0x00, 0x00, "WEBPVP8 ");
/** Major brand is the real container brand. */
const AVIF = header(0x00, 0x00, 0x00, 0x20, "ftyp", "avif", 0x00, 0x00, 0x00, 0x00, "avifmif1");
/** Widely produced variant: `avif` appears only among the compatible brands. */
const AVIF_MIF1 = header(
  0x00, 0x00, 0x00, 0x1c, "ftyp", "mif1", 0x00, 0x00, 0x00, 0x00, "mif1avif",
);

const SUPPORTED = [
  ["image/jpeg", JPEG, "jpg"],
  ["image/png", PNG, "png"],
  ["image/webp", WEBP, "webp"],
  ["image/avif", AVIF, "avif"],
  ["image/avif", AVIF_MIF1, "avif"],
] as const;

test("every supported format is still accepted and keeps its extension", () => {
  for (const [mimeType, bytes, extension] of SUPPORTED) {
    const result = validateProductImageUpload({
      mimeType,
      byteLength: 2048,
      header: bytes,
    });
    assert.equal(result.valid, true, `${mimeType} (${extension}) must stay accepted`);
    if (result.valid) {
      assert.equal(result.extension, extension);
      assert.equal(result.mimeType, mimeType);
    }
  }
});

test("detection reads the container, not the declared type", () => {
  assert.equal(detectImageMimeType(JPEG), "image/jpeg");
  assert.equal(detectImageMimeType(PNG), "image/png");
  assert.equal(detectImageMimeType(WEBP), "image/webp");
  assert.equal(detectImageMimeType(AVIF), "image/avif");
  assert.equal(detectImageMimeType(AVIF_MIF1), "image/avif");
});

test("a non-image payload declaring an image type is refused", () => {
  // The classic bypass: HTML bytes with an image Content-Type header.
  const html = header("<!DOCTYPE html><script>alert(1)</script>");
  const result = validateProductImageUpload({
    mimeType: "image/png",
    byteLength: 512,
    header: html,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid ? "" : result.code, "UNSUPPORTED_IMAGE_TYPE");
});

test("a real image declared as a different image type is refused", () => {
  const result = validateProductImageUpload({
    mimeType: "image/png",
    byteLength: 512,
    header: JPEG,
  });
  assert.equal(result.valid, false);
  assert.equal(result.valid ? "" : result.code, "IMAGE_CONTENT_MISMATCH");
});

test("a RIFF container that is not WebP is refused", () => {
  const wav = header("RIFF", 0x24, 0x00, 0x00, 0x00, "WAVEfmt ");
  assert.equal(detectImageMimeType(wav), null);
});

test("an ftyp box without an AVIF brand is refused", () => {
  const mp4 = header(0x00, 0x00, 0x00, 0x18, "ftyp", "mp42", 0x00, 0x00, 0x00, 0x00, "mp42isom");
  assert.equal(detectImageMimeType(mp4), null);
});

test("size and emptiness are still rejected before the signature is read", () => {
  assert.equal(
    validateProductImageUpload({ mimeType: "image/png", byteLength: 0, header: PNG }).valid,
    false,
  );
  const tooLarge = validateProductImageUpload({
    mimeType: "image/png",
    byteLength: MAX_PRODUCT_IMAGE_BYTES + 1,
    header: PNG,
  });
  assert.equal(tooLarge.valid, false);
  assert.equal(tooLarge.valid ? "" : tooLarge.code, "IMAGE_TOO_LARGE");
});

test("a truncated header cannot be read past its end", () => {
  assert.equal(detectImageMimeType(Uint8Array.from([0xff, 0xd8])), null);
  assert.equal(detectImageMimeType(new Uint8Array(0)), null);
  assert.equal(detectImageMimeType(Uint8Array.from([0x00, 0x00, 0x00, 0x20, 0x66])), null);
});

test("SVG is refused by both the type allowlist and the signature", () => {
  const svg = header('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  // An SVG renders script when served inline, so it is not an allowed type...
  const declared = validateProductImageUpload({
    mimeType: "image/svg+xml",
    byteLength: 256,
    header: svg,
  });
  assert.equal(declared.valid, false);
  assert.equal(declared.valid ? "" : declared.code, "UNSUPPORTED_IMAGE_TYPE");
  // ...and relabelling it as PNG does not help, because the bytes are checked.
  const relabelled = validateProductImageUpload({
    mimeType: "image/png",
    byteLength: 256,
    header: svg,
  });
  assert.equal(relabelled.valid, false);
  assert.equal(detectImageMimeType(svg), null);
});

test("the stored path is derived from the tenant, not from anything uploaded", () => {
  assert.equal(
    productImagePath("restaurant-a", "product-1", "jpg"),
    "restaurant-a/products/product-1/original.jpg",
  );
  // Two tenants can never collide on one object key.
  assert.notEqual(
    productImagePath("restaurant-a", "product-1", "jpg"),
    productImagePath("restaurant-b", "product-1", "jpg"),
  );
});

test("path segments cannot escape the tenant prefix", () => {
  for (const hostile of [
    "../../etc",
    "restaurant/../../other",
    "a/b",
    "..",
    "",
    "-leading-dash",
    "with space",
    "sub\\dir",
    "%2e%2e%2f",
    "tenant/../../../secrets",
  ]) {
    assert.throws(
      () => productImagePath(hostile, "product-1", "jpg"),
      /invalid storage identifier/,
      `restaurant segment ${JSON.stringify(hostile)} must be refused`,
    );
    assert.throws(
      () => productImagePath("restaurant-a", hostile, "jpg"),
      /invalid storage identifier/,
      `product segment ${JSON.stringify(hostile)} must be refused`,
    );
  }
});

test("only the four supported extensions can reach a storage key", () => {
  for (const extension of ["svg", "html", "php", "js", "jpg.html", ""]) {
    assert.throws(
      () => productImagePath("restaurant-a", "product-1", extension),
      /extension is not supported/,
      `extension ${JSON.stringify(extension)} must be refused`,
    );
  }
  for (const extension of ["jpg", "png", "webp", "avif", "JPG"]) {
    assert.ok(productImagePath("restaurant-a", "product-1", extension));
  }
});

test("the upload route keeps its admin, origin and tenant bindings", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/api/admin/products/[productId]/image/route.ts"),
    "utf8",
  );
  // Unauthenticated and non-admin callers are stopped by these two lines; the
  // storage key is bound to the session tenant rather than to any input.
  assert.match(source, /assertTrustedMutationOrigin\(request\)/);
  assert.match(source, /requireCurrentStaffPrincipal\(ADMIN_ROLES\)/);
  assert.match(source, /productImagePath\(\s*principal\.restaurantId/);
  // The declared header must not decide what is served back.
  assert.match(source, /contentType: validation\.mimeType/);
  assert.doesNotMatch(source, /contentType: file\.type/);
});
