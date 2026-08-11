import type { RestaurantTable } from "@/types";

export const restaurantTables: RestaurantTable[] = [
  { id: "1", name: "Masa 1", status: "available", seats: 4, qrAvailable: true, lastActivity: "12 dk önce" },
  { id: "2", name: "Masa 2", status: "ordering", seats: 2, qrAvailable: true, lastActivity: "1 dk önce", activeMinutes: 8, total: 710, orderId: "ORD-2418" },
  { id: "3", name: "Masa 3", status: "dining", seats: 4, qrAvailable: true, lastActivity: "4 dk önce", activeMinutes: 31, total: 980, orderId: "ORD-2415" },
  { id: "4", name: "Masa 4", status: "waiter-call", seats: 4, qrAvailable: true, lastActivity: "35 sn önce", activeMinutes: 45, total: 905, orderId: "ORD-2412" },
  { id: "5", name: "Masa 5", status: "bill-requested", seats: 6, qrAvailable: true, lastActivity: "1 dk önce", activeMinutes: 67, total: 1420, orderId: "ORD-2409" },
  { id: "6", name: "Masa 6", status: "cleaning", seats: 2, qrAvailable: true, lastActivity: "3 dk önce" },
  { id: "7", name: "Masa 7", status: "occupied", seats: 4, qrAvailable: true, lastActivity: "6 dk önce", activeMinutes: 14, total: 755, orderId: "ORD-2417" },
  { id: "8", name: "Masa 8", status: "waiting", seats: 4, qrAvailable: true, lastActivity: "4 dk önce", activeMinutes: 12, total: 905, orderId: "ORD-2419" },
  { id: "9", name: "Masa 9", status: "available", seats: 2, qrAvailable: true, lastActivity: "22 dk önce" },
  { id: "10", name: "Masa 10", status: "dining", seats: 6, qrAvailable: true, lastActivity: "9 dk önce", activeMinutes: 38, total: 1860, orderId: "ORD-2411" },
  { id: "11", name: "Masa 11", status: "available", seats: 4, qrAvailable: true, lastActivity: "18 dk önce" },
  { id: "12", name: "Masa 12", status: "bill-requested", seats: 4, qrAvailable: true, lastActivity: "35 sn önce", activeMinutes: 54, total: 1150, orderId: "ORD-2410" },
];
