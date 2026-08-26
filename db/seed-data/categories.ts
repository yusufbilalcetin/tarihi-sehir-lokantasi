import type { Category } from "@/types";

/** Each cover is a category-scoped asset, never one of the product photos. */
type SeedCategory = Category & { image: string };

export const categories: SeedCategory[] = [
  { id: "soups", name: "Çorbalar", slug: "corbalar", productCount: 12, image: "/images/food/category-corbalar.jpg", active: true, sortOrder: 1 },
  { id: "grill", name: "Izgaralar", slug: "izgaralar", productCount: 4, image: "/images/food/category-izgaralar.jpg", active: true, sortOrder: 2 },
  { id: "mains", name: "Ana Yemekler", slug: "ana-yemekler", productCount: 9, image: "/images/food/category-ana-yemekler.jpg", active: true, sortOrder: 3 },
  { id: "drinks", name: "İçecekler", slug: "icecekler", productCount: 10, image: "/images/food/category-icecekler.jpg", active: true, sortOrder: 4 },
  { id: "kebabs", name: "Kebaplar", slug: "kebaplar", productCount: 3, image: "/images/food/category-kebaplar.jpg", active: true, sortOrder: 5 },
  { id: "dessert", name: "Tatlılar", slug: "tatlilar", productCount: 10, image: "/images/food/category-tatlilar.jpg", active: true, sortOrder: 6 },
];
