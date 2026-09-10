export type ProductStatus = "active" | "inactive" | "sold-out";

export type TableStatus =
  | "available"
  | "occupied"
  | "ordering"
  | "waiting"
  | "dining"
  | "waiter-call"
  | "bill-requested"
  | "cleaning"
  | "inactive";

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
  /** Cover artwork; absent means the menu falls back to neutral artwork. */
  imageUrl?: string | null;
  /** Stable translation-catalog key; database rows use UUID ids. */
  i18nKey?: string;
  /** Sparse database translations keyed by the shared supported locale code. */
  translations?: import("@/lib/i18n/catalog-localization").CatalogTranslations;
  defaultLocale?: string;
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
  /** Sales-derived bounded popularity snapshot; distinct from curated featured. */
  popular?: boolean;
  /** Stable translation-catalog key; database rows use UUID ids. */
  i18nKey?: string;
  /** Sparse database translations keyed by the shared supported locale code. */
  translations?: import("@/lib/i18n/catalog-localization").CatalogTranslations;
  defaultLocale?: string;
}

export type OrderItemStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled"
  | "voided";

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  image?: string;
  status?: OrderItemStatus;
}

export interface Order {
  id: string;
  orderNumber: string;
  /** Null on takeaway and courier orders, which belong to no table. */
  tableId: string | null;
  /**
   * Where the order is, in words. A table name for dine-in; "Paket Sipariş"
   * or "Kurye Siparişi" otherwise. Every screen that shows an order's location
   * reads this one field, so none of them has to know about channels.
   */
  tableName: string;
  createdAt: string;
  elapsedMinutes: number;
  /** The optimistic-lock version an item command has to send back. */
  version: number;
  /**
   * What this order still owes, as the server derived it. A decimal string,
   * kept as one so no screen turns money into a float on the way in. Null when
   * the balance was not requested — which is not the same as owing nothing.
   */
  outstanding: string | null;
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
  | "Masa notu"
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
