export type ProductStatus = "active" | "inactive" | "sold-out";

export type TableStatus =
  | "available"
  | "occupied"
  | "ordering"
  | "waiting"
  | "dining"
  | "waiter-call"
  | "bill-requested"
  | "cleaning";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "completed"
  | "cancelled";

export interface Category {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  active: boolean;
  sortOrder: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  category: string;
  image: string;
  weight?: string;
  allergens: string[];
  tags: string[];
  status: ProductStatus;
  featured?: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  image?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  tableId: string;
  tableName: string;
  createdAt: string;
  elapsedMinutes: number;
  items: OrderItem[];
  status: OrderStatus;
  total: number;
  waiterName?: string;
  note?: string;
}

export interface RestaurantTable {
  id: string;
  name: string;
  status: TableStatus;
  seats: number;
  openedAt?: string;
  activeMinutes?: number;
  total?: number;
  qrAvailable: boolean;
  lastActivity: string;
  orderId?: string;
}

export type StaffRole = "ADMIN" | "Garson" | "Şef Garson" | "Mutfak" | "Kasa";

export type StaffPermission =
  | "Sipariş görüntüle"
  | "Sipariş ekle"
  | "Sipariş iptal"
  | "Tükendi işaretle"
  | "İndirim uygula"
  | "Menü düzenle"
  | "Rapor görüntüle";

export interface StaffUser {
  id: string;
  name: string;
  code: string;
  role: StaffRole;
  roleLabel: string;
  active: boolean;
  phone: string;
  shift: string;
  permissions: StaffPermission[];
}

export type WaiterCallType =
  | "Garson çağır"
  | "Sipariş vereceğim"
  | "Su istiyorum"
  | "Ekmek istiyorum"
  | "Ek servis istiyorum"
  | "Hesap istiyor"
  | "Diğer";

export interface WaiterCall {
  id: string;
  tableId: string;
  tableName: string;
  type: WaiterCallType;
  elapsed: string;
  createdAt: string;
  assignedTo?: string;
  status: "open" | "assigned" | "resolved";
}

export interface Payment {
  id: string;
  tableId: string;
  orderId: string;
  amount: number;
  method: "cash" | "card" | "other";
  status: "pending" | "paid";
  createdAt: string;
}

export interface ReportPoint {
  label: string;
  sales: number;
  orders: number;
}

export interface CartItem extends OrderItem {
  product: Product;
}
