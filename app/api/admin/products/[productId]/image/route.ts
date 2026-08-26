import { NextResponse } from "next/server";

import { auditRequestContext } from "@/lib/api/audit-request";
import { ADMIN_NO_STORE_HEADERS, ADMIN_ROLES, createAdminMenuService, parseParams } from "@/lib/api/admin-route";
import { DomainError, validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getConfiguredProductImagesBucket } from "@/lib/supabase/storage.server";
import {
  IMAGE_SIGNATURE_BYTES,
  productImagePath,
  validateProductImageUpload,
} from "@/lib/supabase/storage";
import { productIdParamsSchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

const logger = createLogger("api.admin.product-image");

const UPLOAD_ERRORS = {
  EMPTY_IMAGE: "Görsel dosyası boş.",
  IMAGE_TOO_LARGE: "Görsel en fazla 5 MB olabilir.",
  UNSUPPORTED_IMAGE_TYPE: "Yalnızca JPEG, PNG, WebP veya AVIF yükleyebilirsiniz.",
  IMAGE_CONTENT_MISMATCH: "Dosya içeriği belirtilen görsel türüyle uyuşmuyor.",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(ADMIN_ROLES);
    const params = parseParams(await context.params, productIdParamsSchema, "Ürün kimliği geçersiz.");

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw validationError("Görsel dosyası gereklidir.");

    // The raw filename is never used, and the declared type only has to agree
    // with the signature: the bytes decide what is stored and how it is served.
    const header = new Uint8Array(
      await file.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer(),
    );
    const validation = validateProductImageUpload({
      mimeType: file.type,
      byteLength: file.size,
      header,
    });
    if (!validation.valid) {
      throw validationError(UPLOAD_ERRORS[validation.code]);
    }

    const bucket = getConfiguredProductImagesBucket();
    const path = productImagePath(principal.restaurantId, params.productId, validation.extension);
    const storage = getSupabaseAdminClient().storage.from(bucket);

    const uploaded = await storage.upload(path, file, {
      // Serve back the type the bytes actually are, never the declared header.
      contentType: validation.mimeType,
      upsert: true,
    });
    if (uploaded.error) {
      throw new DomainError("CONFLICT", "Görsel yüklenemedi.", { httpStatus: 409 });
    }

    const publicUrl = storage.getPublicUrl(path).data.publicUrl;
    try {
      const product = await createAdminMenuService().saveProduct(principal, {
        productId: params.productId,
        imageUrl: publicUrl,
        requestId: auditRequestContext(request).requestId,
      });
      return NextResponse.json(apiSuccess(product), {
        status: 200,
        headers: ADMIN_NO_STORE_HEADERS,
      });
    } catch (error) {
      // The object would otherwise be orphaned by a failed database write.
      const removal = await storage.remove([path]);
      if (removal.error) {
        logger.error("orphan_cleanup_failed", "Uploaded product image could not be removed.", {
          bucket,
        });
      }
      throw error;
    }
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("upload_failed", "Product image could not be stored.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: ADMIN_NO_STORE_HEADERS,
    });
  }
}
