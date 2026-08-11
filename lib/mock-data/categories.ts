import type { Category } from "@/types";

export const categories: Category[] = [
  { id: "soups", name: "Çorbalar", slug: "corbalar", productCount: 12, active: true, sortOrder: 1 },
  { id: "grill", name: "Izgaralar", slug: "izgaralar", productCount: 4, active: true, sortOrder: 2 },
  { id: "mains", name: "Ana Yemekler", slug: "ana-yemekler", productCount: 9, active: true, sortOrder: 3 },
  { id: "drinks", name: "İçecekler", slug: "icecekler", productCount: 10, active: true, sortOrder: 4 },
  { id: "kebabs", name: "Kebaplar", slug: "kebaplar", productCount: 3, active: true, sortOrder: 5 },
  { id: "dessert", name: "Tatlılar", slug: "tatlilar", productCount: 10, active: true, sortOrder: 6 },
];
