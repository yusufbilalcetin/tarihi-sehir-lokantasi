"use client";

import { BookOpen } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { MenuOverview } from "@/components/admin/menu-overview";

/** Menü Yönetimi as an application window. Size per the module-size contract. */
export function MenuOverviewModule() {
  return (
    <AdminModuleWindow
      title="Menü Yönetimi"
      description="Kategoriler, ürünler ve menü görünürlüğü."
      icon={BookOpen}
      size="xl"
    >
      <MenuOverview />
    </AdminModuleWindow>
  );
}
