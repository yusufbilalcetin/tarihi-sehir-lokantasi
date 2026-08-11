import type { Metadata } from "next";
import { ProductsManager } from "@/components/admin/products-manager";

export const metadata: Metadata = { title: "Ürünler" };

export default function AdminProductsPage() {
  return <ProductsManager />;
}
