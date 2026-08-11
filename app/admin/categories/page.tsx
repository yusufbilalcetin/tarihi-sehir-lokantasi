import type { Metadata } from "next";
import { CategoriesManager } from "@/components/admin/categories-manager";

export const metadata: Metadata = { title: "Kategoriler" };

export default function AdminCategoriesPage() {
  return <CategoriesManager />;
}
