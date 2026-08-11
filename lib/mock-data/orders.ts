import type { Order } from "@/types";

export const orders: Order[] = [
  {
    id: "o-2419", orderNumber: "#2419", tableId: "8", tableName: "Masa 8", createdAt: "14:42", elapsedMinutes: 4, status: "pending", total: 905,
    items: [
      { id: "i1", productId: "mercimek", productName: "Mercimek Çorbası", quantity: 2, unitPrice: 120 },
      { id: "i2", productId: "tas-kebabi", productName: "Tas Kebabı", quantity: 1, unitPrice: 320 },
      { id: "i3", productId: "pirinc-pilavi", productName: "Pirinç Pilavı", quantity: 2, unitPrice: 90, note: "Pilavlardan biri tereyağsız." },
      { id: "i4", productId: "ayran", productName: "Yayık Ayranı", quantity: 3, unitPrice: 55 },
    ],
    note: "Pilavlardan biri tereyağsız.",
  },
  {
    id: "o-2418", orderNumber: "#2418", tableId: "2", tableName: "Masa 2", createdAt: "14:37", elapsedMinutes: 9, status: "preparing", total: 710,
    items: [
      { id: "i5", productId: "kuzu-tandir", productName: "Kuzu Tandır", quantity: 1, unitPrice: 420 },
      { id: "i6", productId: "pirinc-pilavi", productName: "Pirinç Pilavı", quantity: 2, unitPrice: 90 },
      { id: "i7", productId: "ayran", productName: "Yayık Ayranı", quantity: 2, unitPrice: 55 },
    ], waiterName: "Ahmet",
  },
  {
    id: "o-2417", orderNumber: "#2417", tableId: "7", tableName: "Masa 7", createdAt: "14:34", elapsedMinutes: 12, status: "ready", total: 755,
    items: [
      { id: "i8", productId: "izgara-kofte", productName: "Izgara Köfte", quantity: 2, unitPrice: 350, note: "Bir porsiyon az pişmiş." },
      { id: "i9", productId: "ayran", productName: "Yayık Ayranı", quantity: 1, unitPrice: 55 },
    ], waiterName: "Mehmet",
  },
  {
    id: "o-2415", orderNumber: "#2415", tableId: "3", tableName: "Masa 3", createdAt: "14:20", elapsedMinutes: 26, status: "served", total: 980,
    items: [
      { id: "i10", productId: "tas-kebabi", productName: "Tas Kebabı", quantity: 2, unitPrice: 320 },
      { id: "i11", productId: "mercimek", productName: "Mercimek Çorbası", quantity: 1, unitPrice: 120 },
      { id: "i12", productId: "ayran", productName: "Yayık Ayranı", quantity: 4, unitPrice: 55 },
    ], waiterName: "Ahmet",
  },
  {
    id: "o-2412", orderNumber: "#2412", tableId: "4", tableName: "Masa 4", createdAt: "14:01", elapsedMinutes: 45, status: "served", total: 905,
    items: [
      { id: "i13", productId: "mercimek", productName: "Mercimek Çorbası", quantity: 2, unitPrice: 120 },
      { id: "i14", productId: "tas-kebabi", productName: "Tas Kebabı", quantity: 1, unitPrice: 320 },
      { id: "i15", productId: "pirinc-pilavi", productName: "Pirinç Pilavı", quantity: 2, unitPrice: 90 },
      { id: "i16", productId: "ayran", productName: "Yayık Ayranı", quantity: 3, unitPrice: 55 },
    ], waiterName: "Ahmet",
  },
  {
    id: "o-2411", orderNumber: "#2411", tableId: "10", tableName: "Masa 10", createdAt: "13:54", elapsedMinutes: 52, status: "served", total: 1860,
    items: [
      { id: "i17", productId: "kuzu-tandir", productName: "Kuzu Tandır", quantity: 2, unitPrice: 420 },
      { id: "i18", productId: "izgara-kofte", productName: "Izgara Köfte", quantity: 2, unitPrice: 350 },
      { id: "i19", productId: "tas-kebabi", productName: "Tas Kebabı", quantity: 1, unitPrice: 320 },
    ], waiterName: "Mehmet",
  },
  {
    id: "o-2410", orderNumber: "#2410", tableId: "12", tableName: "Masa 12", createdAt: "13:47", elapsedMinutes: 59, status: "served", total: 1150,
    items: [
      { id: "i20", productId: "kuzu-tandir", productName: "Kuzu Tandır", quantity: 1, unitPrice: 420 },
      { id: "i21", productId: "izgara-kofte", productName: "Izgara Köfte", quantity: 1, unitPrice: 350 },
      { id: "i22", productId: "kuru-fasulye", productName: "Etli Kuru Fasulye", quantity: 1, unitPrice: 260 },
      { id: "i23", productId: "mercimek", productName: "Mercimek Çorbası", quantity: 1, unitPrice: 120 },
    ], waiterName: "Ahmet",
  },
  {
    id: "o-2409", orderNumber: "#2409", tableId: "5", tableName: "Masa 5", createdAt: "13:39", elapsedMinutes: 67, status: "served", total: 1420,
    items: [
      { id: "i24", productId: "kuzu-tandir", productName: "Kuzu Tandır", quantity: 2, unitPrice: 420 },
      { id: "i25", productId: "kuru-fasulye", productName: "Etli Kuru Fasulye", quantity: 1, unitPrice: 260 },
      { id: "i26", productId: "pirinc-pilavi", productName: "Pirinç Pilavı", quantity: 2, unitPrice: 90 },
      { id: "i27", productId: "firin-sutlac", productName: "Fırın Sütlaç", quantity: 1, unitPrice: 140 },
    ], waiterName: "Ahmet",
  },
];
