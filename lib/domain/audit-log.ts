/**
 * What a recorded change is called on screen.
 *
 * The database stores `order.item.voided`; the person reading it runs a
 * restaurant. Anything without an entry falls back to a plain sentence rather
 * than showing the code, because a raw event name in a list is noise to
 * everyone who is not debugging it.
 */
const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  // Orders and their lines
  ORDER_CREATED: "Sipariş oluşturdu",
  ORDER_STATUS_CHANGED: "Sipariş durumunu değiştirdi",
  ORDER_ITEM_STATUS_CHANGED: "Sipariş kalemini ilerletti",
  "order_item.status_reverted": "Sipariş kalemini geri aldı",
  "order.cancelled": "Siparişi iptal etti",
  "order.item.cancelled": "Sipariş kalemini iptal etti",
  "order.item.voided": "Ürünü hesaptan çıkardı",
  "staff.order.items_added": "Siparişe ürün ekledi",
  // Money
  "payment.refunded": "İade yaptı",
  "order.check.created": "Hesap böldü",
  "order.check.updated": "Hesabı düzenledi",
  "order.check.cancelled": "Hesap bölmesini iptal etti",
  // Cash drawer
  "cashier_shift.opened": "Kasa vardiyasını açtı",
  "cashier_shift.closed": "Kasa vardiyasını kapattı",
  "cash_register.created": "Kasa tanımladı",
  "cash_register.updated": "Kasa bilgisini değiştirdi",
  // Menu
  "product.created": "Ürün ekledi",
  "product.updated": "Ürünü güncelledi",
  "product.archived": "Ürünü arşivledi",
  "category.created": "Kategori ekledi",
  "category.updated": "Kategoriyi güncelledi",
  "category.archived": "Kategoriyi arşivledi",
  "menu.reordered": "Menü sırasını değiştirdi",
  // People
  "staff.created": "Çalışan ekledi",
  "staff.updated": "Çalışan bilgisini değiştirdi",
  "staff.password_reset_requested": "Şifre kurulum bağlantısı gönderdi",
  STAFF_LOGIN_IP: "Giriş yaptı",
  "erp.attendance.clock_in": "Mesai başlattı",
  "erp.attendance.clock_out": "Mesai bitirdi",
  "erp.attendance.corrected": "Puantaj kaydını düzeltti",
  "erp.schedule.created": "Vardiya planı oluşturdu",
  "erp.schedule.status_changed": "Vardiya planını değiştirdi",
  "erp.payroll.upserted": "Ücret hesabını güncelledi",
  // Tables, QR and guest calls
  TABLE_CREATED: "Masa ekledi",
  TABLE_UPDATED: "Masayı güncelledi",
  TABLE_QR_ROTATED: "Masanın QR kodunu yeniledi",
  TABLE_QR_REVOKED: "Masanın QR kodunu iptal etti",
  TABLE_QR_PAUSED: "Masanın QR menüsünü durdurdu",
  TABLE_QR_RESUMED: "Masanın QR menüsünü açtı",
  "table.reset": "Masayı sıfırladı",
  WAITER_CALLED: "Garson çağrısı oluştu",
  "waiter_call.created": "Garson çağrısı oluştu",
  // Settings
  "settings.updated": "İşletme ayarlarını değiştirdi",
  // Printing
  "printer.created": "Yazıcı tanımladı",
  "printer.updated": "Yazıcı bilgisini değiştirdi",
  "printer_agent.created": "Yazdırma bilgisayarı tanımladı",
  "printer_route.created": "Yazdırma yönlendirmesi ekledi",
  // Stock, production and purchasing
  "erp.inventory_item.created": "Stok kalemi ekledi",
  "erp.inventory_item.updated": "Stok kalemini güncelledi",
  "erp.stock_movement.posted": "Stok hareketi girdi",
  "erp.stock_count.completed": "Stok sayımını tamamladı",
  "erp.stock_transfer.completed": "Depolar arası transfer yaptı",
  "erp.warehouse.created": "Depo oluşturdu",
  "erp.waste.recorded": "Fire kaydetti",
  "erp.recipe.created": "Reçete oluşturdu",
  "erp.recipe.updated": "Reçeteyi güncelledi",
  "erp.recipe.activated": "Reçeteyi yürürlüğe aldı",
  "erp.recipe.retired": "Reçeteyi kullanımdan kaldırdı",
  "erp.production.planned": "Üretim planladı",
  "erp.production.completed": "Üretimi tamamladı",
  "erp.supplier.created": "Tedarikçi ekledi",
  "erp.supplier.updated": "Tedarikçiyi güncelledi",
  "erp.supplier_item.upserted": "Tedarikçi ürününü güncelledi",
  "erp.supplier_invoice.created": "Tedarikçi faturası girdi",
  "erp.supplier_payment.recorded": "Tedarikçi ödemesi kaydetti",
  "erp.purchase_order.created": "Satın alma siparişi oluşturdu",
  "erp.purchase_order.status_changed": "Satın alma durumunu değiştirdi",
  "erp.goods_receipt.created": "Mal kabul yaptı",
  "erp.popular_snapshot.refreshed": "Popüler ürün listesini yeniledi",
  // Guests
  "erp.reservation.created": "Rezervasyon oluşturdu",
  "erp.reservation.updated": "Rezervasyonu güncelledi",
  "erp.reservation.status_changed": "Rezervasyon durumunu değiştirdi",
  "erp.fulfillment.created": "Paket/kurye siparişi oluşturdu",
  "erp.fulfillment.order_linked": "Paket siparişini siparişe bağladı",
  "erp.fulfillment.status_changed": "Paket/kurye durumunu değiştirdi",
  "erp.customer_account.created": "Müşteri kaydı oluşturdu",
  "erp.feedback.moderated": "Geri bildirimi değerlendirdi",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? "Bir kayıt değiştirdi";
}

/** What the change was made to, in the words the restaurant uses for it. */
const AUDIT_ENTITY_LABELS: Readonly<Record<string, string>> = {
  ORDER: "Sipariş",
  ORDER_ITEM: "Sipariş kalemi",
  ORDER_CHECK: "Hesap",
  PAYMENT: "Tahsilat",
  CASHIER_SHIFT: "Kasa vardiyası",
  CASH_REGISTER: "Kasa",
  CASH_DRAWER_MOVEMENT: "Kasa hareketi",
  PRODUCT: "Ürün",
  CATEGORY: "Kategori",
  STAFF_PROFILE: "Çalışan",
  TABLE: "Masa",
  WAITER_CALL: "Garson çağrısı",
  RESTAURANT_SETTINGS: "İşletme ayarları",
  PRINTER: "Yazıcı",
  PRINTER_AGENT: "Yazdırma bilgisayarı",
  PRINTER_ROUTE: "Yazdırma yönlendirmesi",
  inventory_item: "Stok kalemi",
  stock_movement: "Stok hareketi",
  stock_count: "Stok sayımı",
  stock_transfer: "Stok transferi",
  warehouse: "Depo",
  waste_record: "Fire",
  recipe_version: "Reçete",
  production_batch: "Üretim",
  supplier: "Tedarikçi",
  supplier_item: "Tedarikçi ürünü",
  supplier_invoice: "Tedarikçi faturası",
  supplier_payment: "Tedarikçi ödemesi",
  purchase_order: "Satın alma",
  goods_receipt: "Mal kabul",
  attendance_record: "Puantaj",
  staff_schedule: "Vardiya planı",
  payroll_entry: "Ücret hesabı",
  reservation: "Rezervasyon",
  fulfillment_request: "Paket/kurye siparişi",
  customer_account: "Müşteri",
  customer_feedback: "Geri bildirim",
  popular_product_snapshot: "Popüler ürünler",
};

export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? "Kayıt";
}

/** The field names inside a change, in the same plain words. */
const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  status: "Durum",
  isActive: "Aktif",
  role: "Görev",
  name: "Ad",
  price: "Fiyat",
  quantity: "Adet",
  amount: "Tutar",
  total: "Toplam",
  outstanding: "Kalan",
  orderNumber: "Sipariş no",
  orderStatus: "Sipariş durumu",
  productName: "Ürün",
  reason: "Gerekçe",
  reasonCode: "Gerekçe",
  reasonNote: "Açıklama",
  note: "Not",
  from: "Önceki",
  to: "Sonraki",
  version: "Sürüm",
  cashVariance: "Kasa farkı",
  openingCash: "Açılış nakdi",
  countedCash: "Sayılan nakit",
  clockInAt: "Giriş",
  clockOutAt: "Çıkış",
  breakMinutes: "Mola (dk)",
  category: "Grup",
  unit: "Birim",
  yieldPortions: "Porsiyon",
  ingredientCount: "Malzeme sayısı",
  windowDays: "Gün aralığı",
  productCount: "Ürün sayısı",
  tableId: "Masa",
  tableNumber: "Masa no",
  closeNote: "Kapanış notu",
};

/**
 * Every field the allowlist admits has a word here, so this never prints a
 * column name at somebody. A field that reached the screen without one would
 * be an allowlist entry somebody forgot to name, and "Değer" says that
 * honestly rather than leaking the identifier.
 */
export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? "Değer";
}

/**
 * The fields a change record may carry to the screen.
 *
 * An allowlist, not a filter. `old_value`, `new_value` and `metadata` are free
 * JSON written by a dozen different services, so anything not named here stays
 * on the server — a future service adding a token or a key to its metadata
 * cannot leak it through this endpoint by accident.
 */
export const AUDIT_SAFE_FIELDS: readonly string[] = [
  "status",
  "isActive",
  "role",
  "name",
  "price",
  "quantity",
  "amount",
  "total",
  "outstanding",
  "orderNumber",
  "orderStatus",
  "productName",
  "tableId",
  "tableNumber",
  "reason",
  "reasonCode",
  "reasonNote",
  "note",
  "from",
  "to",
  "version",
  "category",
  "unit",
  "yieldPortions",
  "ingredientCount",
  "windowDays",
  "productCount",
  "clockInAt",
  "clockOutAt",
  "breakMinutes",
  "closeNote",
  "cashVariance",
  "openingCash",
  "countedCash",
];

/** Anything whose name even hints at a credential never crosses the wire. */
const SECRET_PATTERN = /pass|token|secret|credential|authorization|session|apikey|api_key|key$/i;

export interface AuditChangeField {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly at: string;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  /** The action in the restaurant's words, never the raw code. */
  readonly actionLabel: string;
  readonly entityType: string;
  readonly entityLabel: string;
  readonly entityId: string | null;
  /** Allowlisted before/after pairs, already stringified for display. */
  readonly changes: readonly AuditChangeField[];
  /** Only ever shown under "Teknik ayrıntılar". */
  readonly requestId: string | null;
}

export interface AuditLogPage {
  readonly entries: readonly AuditLogEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface AuditLogQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly actorId?: string;
  readonly action?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.slice(0, 120);
  // Objects and arrays are not shown: a nested shape is a technical detail,
  // and rendering it raw is how a secret nobody expected reaches a screen.
  return null;
}

/** Before/after, reduced to the named fields and to values a person can read. */
export function projectAuditChanges(
  oldValue: unknown,
  newValue: unknown,
): readonly AuditChangeField[] {
  const before = (oldValue ?? {}) as Record<string, unknown>;
  const after = (newValue ?? {}) as Record<string, unknown>;
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return names
    .filter((name) => AUDIT_SAFE_FIELDS.includes(name) && !SECRET_PATTERN.test(name))
    .map((field) => ({
      field,
      before: displayValue(before[field]),
      after: displayValue(after[field]),
    }))
    .filter((change) => change.before !== null || change.after !== null)
    .slice(0, 12);
}

