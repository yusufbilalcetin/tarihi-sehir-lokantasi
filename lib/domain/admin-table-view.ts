import type { TableStatus } from "@/lib/domain/status";

export const ADMIN_TABLE_STATUS_LABELS: Readonly<Record<TableStatus, string>> = {
  AVAILABLE: "Boş",
  OCCUPIED: "Dolu",
  ORDERING: "Sipariş veriyor",
  WAITING: "Sipariş bekliyor",
  DINING: "Yemekte",
  WAITER_CALL: "Garson çağrısı",
  BILL_REQUESTED: "Hesap istedi",
  CLEANING: "Temizleniyor",
  INACTIVE: "Servis kapalı",
};

export type AdminTableFilter =
  | "ALL"
  | "ACTIVE"
  | "AVAILABLE"
  | "WAITING"
  | "DINING"
  | "WAITER_CALL"
  | "BILL_REQUESTED"
  | "CLEANING"
  | "INACTIVE";

export interface OperationalTableLike {
  readonly status: string;
}

export function isKnownTableStatus(status: string): status is TableStatus {
  return Object.hasOwn(ADMIN_TABLE_STATUS_LABELS, status);
}

export function adminTableStatusLabel(status: string): string {
  return isKnownTableStatus(status) ? ADMIN_TABLE_STATUS_LABELS[status] : "Boş";
}

export function matchesAdminTableFilter(
  table: OperationalTableLike,
  filter: AdminTableFilter,
): boolean {
  if (filter === "ALL") return true;
  if (filter === "ACTIVE") return !["AVAILABLE", "INACTIVE"].includes(table.status);
  return table.status === filter;
}

export function summarizeAdminTables(tables: readonly OperationalTableLike[]) {
  const count = (status: TableStatus) => tables.filter((table) => table.status === status).length;
  return {
    total: tables.length,
    available: count("AVAILABLE"),
    active: tables.filter((table) => !["AVAILABLE", "INACTIVE"].includes(table.status)).length,
    waiting: count("WAITING") + count("ORDERING"),
    dining: count("DINING") + count("OCCUPIED"),
    waiterCalls: count("WAITER_CALL"),
    billRequested: count("BILL_REQUESTED"),
    cleaning: count("CLEANING"),
    inactive: count("INACTIVE"),
  } as const;
}
