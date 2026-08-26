"use client";

import { PackageOpen } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { ProductsManager } from "@/components/admin/products-manager";

/** Ürünler as an application window. Size per the module-size contract. */
export function ProductsManagerModule() {
  return (
    <AdminModuleWindow
      title="Ürünler"
      description="Ürünleri ara, fiyatla ve uygunluklarını yönet."
      icon={PackageOpen}
      size="xl"
    >
      <ProductsManager />
    </AdminModuleWindow>
  );
}
