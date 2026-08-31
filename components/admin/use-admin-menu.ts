"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiClientError } from "@/lib/api/client";
import { adminApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime, type StaffRealtimeStatus } from "@/lib/realtime/use-staff-realtime";
import type { AdminCategoryResult, AdminProductResult } from "@/lib/services/admin-menu-service";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import type { Category, Product, ProductStatus } from "@/types";

const ADMIN_MENU_POLL_MS = 30_000;

const EMPTY_CATEGORIES: readonly AdminCategoryResult[] = [];
const EMPTY_PRODUCTS: readonly AdminProductResult[] = [];

export function adminProductStatus(product: AdminProductResult): ProductStatus {
  if (!product.isActive || product.archived) return "inactive";
  return product.isAvailable ? "active" : "sold-out";
}

export interface AdminMenuState {
  readonly categories: readonly AdminCategoryResult[];
  readonly products: readonly AdminProductResult[];
  /** False when this deployment has no translation provider configured. */
  readonly autoTranslateAvailable: boolean;
  /** Fixture-shaped projections so the existing admin tables render unchanged. */
  readonly categoryViews: readonly Category[];
  readonly productViews: readonly Product[];
  readonly loading: boolean;
  readonly error: ApiClientError | null;
  readonly saving: boolean;
  readonly realtimeStatus: StaffRealtimeStatus;
  readonly refetch: () => Promise<void>;
  readonly run: <TResult>(
    work: () => Promise<TResult>,
    successMessage: string,
  ) => Promise<TResult | null>;
}

export function useAdminMenu(): AdminMenuState {
  const [saving, setSaving] = useState(false);
  const loadMenu = useCallback((signal: AbortSignal) => adminApi.menu(signal), []);
  const resource = useApiResource(loadMenu, { pollMs: ADMIN_MENU_POLL_MS });
  const { refetch } = resource;
  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

  // Stable empty references keep the memo dependencies from changing per render.
  const categories = resource.data?.categories ?? EMPTY_CATEGORIES;
  const products = resource.data?.products ?? EMPTY_PRODUCTS;
  const autoTranslateAvailable = resource.data?.autoTranslateAvailable ?? false;

  const categoryViews = useMemo<Category[]>(
    () =>
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        imageUrl: category.imageUrl,
        productCount: products.filter((product) => product.categoryId === category.id).length,
        active: category.isActive && !category.archived,
        sortOrder: category.sortOrder,
      })),
    [categories, products],
  );

  const productViews = useMemo<Product[]>(
    () =>
      products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description ?? "",
        price: Number(product.price),
        categoryId: product.categoryId,
        category: categories.find((category) => category.id === product.categoryId)?.name ?? "Diğer",
        image: product.imageUrl ?? MENU_PLACEHOLDER_IMAGE,
        weight: product.weightLabel ?? undefined,
        allergens: [...product.allergens],
        tags: [...product.tags],
        status: adminProductStatus(product),
        featured: product.isFeatured,
      })),
    [categories, products],
  );

  const run = useCallback(
    async <TResult>(work: () => Promise<TResult>, successMessage: string) => {
      if (saving) return null;
      setSaving(true);
      try {
        const result = await work();
        await refetch();
        toast.success(successMessage);
        return result;
      } catch (error) {
        toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [refetch, saving],
  );

  return {
    categories,
    products,
    autoTranslateAvailable,
    categoryViews,
    productViews,
    loading: resource.loading,
    error: resource.error,
    saving,
    realtimeStatus,
    refetch,
    run,
  };
}
