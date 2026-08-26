import type { Metadata } from "next";
import { CategoriesManagerModule } from "@/components/admin/categories-module";

export const metadata: Metadata = { title: "Kategoriler" };

export default function AdminCategoriesManagerPage() {
  return <CategoriesManagerModule />;
}
