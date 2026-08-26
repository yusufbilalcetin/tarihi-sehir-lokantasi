"use client";

import { Layers3 } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { CategoriesManager } from "@/components/admin/categories-manager";

/** Kategoriler as an application window. Size per the module-size contract. */
export function CategoriesManagerModule() {
  return (
    <AdminModuleWindow
      title="Kategoriler"
      description="Menü kategorilerini düzenle ve sıralamayı yönet."
      icon={Layers3}
      size="lg"
    >
      <CategoriesManager />
    </AdminModuleWindow>
  );
}
