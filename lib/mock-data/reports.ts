import type { ReportPoint } from "@/types";

export const weeklySales: ReportPoint[] = [
  { label: "Pzt", sales: 12480, orders: 51 },
  { label: "Sal", sales: 13920, orders: 56 },
  { label: "Çar", sales: 12160, orders: 49 },
  { label: "Per", sales: 15640, orders: 63 },
  { label: "Cum", sales: 18420, orders: 74 },
  { label: "Cmt", sales: 22780, orders: 91 },
  { label: "Paz", sales: 20940, orders: 84 },
];

export const categorySales = [
  { name: "Et Yemekleri", value: 38 },
  { name: "Ev Yemekleri", value: 24 },
  { name: "Çorbalar", value: 15 },
  { name: "Tatlılar", value: 13 },
  { name: "İçecekler", value: 10 },
];

export const hourlyOrders = [
  { hour: "11:00", orders: 5 }, { hour: "12:00", orders: 13 }, { hour: "13:00", orders: 18 },
  { hour: "14:00", orders: 16 }, { hour: "15:00", orders: 8 }, { hour: "16:00", orders: 6 },
  { hour: "17:00", orders: 9 }, { hour: "18:00", orders: 15 }, { hour: "19:00", orders: 21 },
  { hour: "20:00", orders: 17 }, { hour: "21:00", orders: 11 },
];

export const bestSellers = [
  { name: "Kuzu Tandır", count: 28, revenue: 11760 },
  { name: "Mercimek Çorbası", count: 24, revenue: 2880 },
  { name: "Tas Kebabı", count: 21, revenue: 6720 },
  { name: "Fırın Sütlaç", count: 19, revenue: 2660 },
];
