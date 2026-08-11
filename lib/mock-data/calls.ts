import type { WaiterCall } from "@/types";

export const waiterCalls: WaiterCall[] = [
  { id: "c1", tableId: "12", tableName: "Masa 12", type: "Hesap istiyor", elapsed: "35 saniye önce", createdAt: "14:46", status: "open" },
  { id: "c2", tableId: "4", tableName: "Masa 4", type: "Su istiyorum", elapsed: "1 dakika önce", createdAt: "14:45", status: "open" },
  { id: "c3", tableId: "7", tableName: "Masa 7", type: "Ek servis istiyorum", elapsed: "3 dakika önce", createdAt: "14:43", status: "assigned", assignedTo: "Mehmet" },
  { id: "c4", tableId: "10", tableName: "Masa 10", type: "Sipariş vereceğim", elapsed: "5 dakika önce", createdAt: "14:41", status: "open" },
];
