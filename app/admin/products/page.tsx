import type { Metadata } from "next";
import { ProductsManagerModule } from "@/components/admin/products-module";

export const metadata: Metadata = { title: "Ürünler" };

export default function AdminProductsManagerPage() {
  return <ProductsManagerModule />;
}
