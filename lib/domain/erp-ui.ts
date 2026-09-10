import type { ErpWorkspaceModule } from "@/lib/domain/erp-workspaces";

export interface ErpColumn {
  readonly key: string;
  readonly label: string;
  readonly kind?: "text" | "money" | "quantity" | "date" | "datetime" | "status" | "percent" | "duration" | "boolean";
}

export interface ErpUiConfig {
  readonly title: string;
  readonly description: string;
  readonly question: string;
  readonly empty: string;
  readonly columns: readonly ErpColumn[];
  readonly statuses?: readonly { value: string; label: string }[];
}

export const ERP_UI_CONFIG: Readonly<Record<ErpWorkspaceModule, ErpUiConfig>> = {
  sales: { title:"Satış Raporu",description:"İş günü ve kanal bazında brüt satış; toplam, finans özetiyle aynı iş kuralından okunur.",question:"Bugün hangi kanaldan ne kadar sattık?",empty:"Seçili aralıkta tamamlanmış satış yok.",columns:[{key:"business_date",label:"İş Günü",kind:"date"},{key:"channel",label:"Kanal",kind:"status"},{key:"order_count",label:"Sipariş"},{key:"gross_sales",label:"Brüt Satış",kind:"money"},{key:"average_check",label:"Ortalama Adisyon",kind:"money"}],statuses:[{value:"DINE_IN",label:"Masada"},{value:"TAKEAWAY",label:"Paket"},{value:"DELIVERY",label:"Kurye"}]},
  "stock-movements": { title:"Stok Hareketleri",description:"Stok bakiyesinin tek kaynağı olan hareketlerin tarih aralıklı dökümü.",question:"Stok neden ve ne zaman değişti?",empty:"Seçili aralıkta stok hareketi yok.",columns:[{key:"occurred_at",label:"Tarih",kind:"datetime"},{key:"inventory_item",label:"Stok Kalemi"},{key:"warehouse",label:"Depo"},{key:"movement_type",label:"Hareket",kind:"status"},{key:"quantity_delta",label:"Miktar",kind:"quantity"},{key:"unit",label:"Birim"},{key:"unit_cost",label:"Birim Maliyet",kind:"money"},{key:"reason",label:"Açıklama"},{key:"recorded_by",label:"Kaydeden"}],statuses:[{value:"PURCHASE_RECEIPT",label:"Mal kabul"},{value:"PRODUCTION_CONSUMPTION",label:"Üretim tüketimi"},{value:"MANUAL_ADJUSTMENT",label:"Manuel düzeltme"},{value:"WASTE",label:"Fire"},{value:"TRANSFER_IN",label:"Depolar arası giriş"},{value:"TRANSFER_OUT",label:"Depolar arası çıkış"},{value:"COUNT_CORRECTION",label:"Sayım farkı"}]},
  "stock-counts": { title:"Sayım Farkları",description:"Fiziksel sayım anında kaydedilen sistem miktarı, sayılan miktar ve aradaki fark.",question:"Sayımda ne kadar fark çıktı?",empty:"Seçili aralıkta fiziksel sayım kaydı yok.",columns:[{key:"counted_at",label:"Sayım Tarihi",kind:"datetime"},{key:"warehouse",label:"Depo"},{key:"inventory_item",label:"Stok Kalemi"},{key:"system_quantity",label:"Sistem Miktarı",kind:"quantity"},{key:"counted_quantity",label:"Sayılan",kind:"quantity"},{key:"variance",label:"Fark",kind:"quantity"},{key:"unit",label:"Birim"},{key:"status",label:"Durum",kind:"status"},{key:"counted_by",label:"Sayan"}],statuses:[{value:"DRAFT",label:"Taslak"},{value:"COMPLETED",label:"Tamamlandı"},{value:"CANCELLED",label:"İptal"}]},
  inventory: { title:"Stok Yönetimi",description:"Depo bazında kullanılabilir miktar, kritik seviye ve stok politikası.",question:"Neyin stoğu azalıyor?",empty:"Henüz stok kalemi bulunmuyor.",columns:[{key:"name",label:"Stok Kalemi"},{key:"category",label:"Grup"},{key:"available_quantity",label:"Kullanılabilir",kind:"quantity"},{key:"critical_quantity",label:"Kritik Seviye",kind:"quantity"},{key:"negative_stock_policy",label:"Negatif Stok",kind:"status"},{key:"is_active",label:"Kayıt",kind:"boolean"},{key:"critical",label:"Stok Durumu",kind:"boolean"}],statuses:[{value:"ACTIVE",label:"Aktif"},{value:"INACTIVE",label:"Pasif"}]},
  warehouses: { title:"Depolar",description:"Fiziksel stok konumları, hareket yoğunluğu ve depolar arası transfer.",question:"Stok nerede?",empty:"Henüz depo bulunmuyor.",columns:[{key:"name",label:"Depo"},{key:"code",label:"Kod"},{key:"stocked_items",label:"Stok Kalemi"},{key:"movement_count",label:"Hareket"},{key:"last_movement_at",label:"Son Hareket",kind:"datetime"},{key:"is_active",label:"Durum",kind:"boolean"}]},
  recipes: { title:"Reçeteler",description:"Ürün reçetelerinin sürümleri, yaşam döngüsü, porsiyon verimi ve bileşenleri.",question:"Bu yemek nasıl ve hangi sürümle hazırlanıyor?",empty:"Henüz reçete sürümü bulunmuyor.",columns:[{key:"product",label:"Ürün"},{key:"version",label:"Sürüm"},{key:"status",label:"Durum",kind:"status"},{key:"yield_portions",label:"Verim",kind:"quantity"},{key:"ingredient_count",label:"Bileşen"},{key:"batch_cost",label:"Üretim Maliyeti",kind:"money"},{key:"portion_cost",label:"Porsiyon Maliyeti",kind:"money"},{key:"effective_from",label:"Başlangıç",kind:"datetime"}],statuses:[{value:"DRAFT",label:"Taslak"},{value:"ACTIVE",label:"Aktif"},{value:"RETIRED",label:"Emekli"}]},
  costing: { title:"Maliyet",description:"Aktif reçete fiyatlarından porsiyon maliyeti, katkı ve maliyet oranı.",question:"Bu yemek bize ne kadara mal oluyor?",empty:"Maliyet hesaplanabilecek reçete bulunmuyor.",columns:[{key:"product",label:"Ürün"},{key:"category",label:"Kategori"},{key:"selling_price",label:"Satış Fiyatı",kind:"money"},{key:"portion_cost",label:"Porsiyon Maliyeti",kind:"money"},{key:"contribution",label:"Ürün Katkısı",kind:"money"},{key:"food_cost_percent",label:"Maliyet Oranı",kind:"percent"},{key:"status",label:"Reçete",kind:"status"},{key:"missing_cost_count",label:"Eksik Fiyat"}]},
  production: { title:"Günlük Üretim",description:"İş günü bazında planlanan, hazırlanan, satılan, fire ve kalan porsiyon.",question:"Bugün ne kadar hazırlıyoruz?",empty:"Seçili aralıkta üretim planı yok.",columns:[{key:"business_date",label:"İş Günü",kind:"date"},{key:"product",label:"Ürün"},{key:"warehouse",label:"Depo"},{key:"planned_portions",label:"Planlanan",kind:"quantity"},{key:"prepared_portions",label:"Hazırlanan",kind:"quantity"},{key:"sold_portions",label:"Satılan",kind:"quantity"},{key:"waste_portions",label:"Fire",kind:"quantity"},{key:"remaining_portions",label:"Kalan",kind:"quantity"},{key:"sell_through_percent",label:"Satış Oranı",kind:"percent"},{key:"status",label:"Durum",kind:"status"}]},
  waste: { title:"Fire ve Kayıp",description:"Fire, personel yemeği, ikram ve diğer stok kayıpları.",question:"Nerede ve neden kayıp yaşıyoruz?",empty:"Seçili aralıkta fire kaydı yok.",columns:[{key:"occurred_at",label:"Tarih",kind:"datetime"},{key:"inventory_item",label:"Stok Kalemi"},{key:"warehouse",label:"Depo"},{key:"quantity",label:"Miktar",kind:"quantity"},{key:"unit",label:"Birim"},{key:"waste_type",label:"Tür",kind:"status"},{key:"estimated_cost",label:"Tahmini Maliyet",kind:"money"},{key:"reason",label:"Neden"},{key:"recorded_by",label:"Kaydeden"}]},
  suppliers: { title:"Tedarikçiler",description:"İletişim, ürün eşleştirmeleri, satın alma geçmişi ve açık bakiye.",question:"Kimden alıyoruz ve ne kadar borçluyuz?",empty:"Henüz tedarikçi bulunmuyor.",columns:[{key:"name",label:"Tedarikçi"},{key:"contact_person",label:"Yetkili"},{key:"phone",label:"Telefon"},{key:"email",label:"E-posta"},{key:"item_count",label:"Ürün"},{key:"purchase_count",label:"Satın Alma"},{key:"outstanding_balance",label:"Açık Bakiye",kind:"money"},{key:"is_active",label:"Durum",kind:"boolean"}]},
  purchasing: { title:"Satın Alma",description:"Sipariş, kalan miktar ve kısmi mal kabul takibi.",question:"Hangi siparişin mal kabulü bekleniyor?",empty:"Seçili aralıkta satın alma siparişi yok.",columns:[{key:"order_number",label:"Sipariş No"},{key:"supplier",label:"Tedarikçi"},{key:"order_date",label:"Tarih",kind:"datetime"},{key:"status",label:"Durum",kind:"status"},{key:"total",label:"Toplam",kind:"money"},{key:"ordered_quantity",label:"Sipariş",kind:"quantity"},{key:"received_quantity",label:"Kabul",kind:"quantity"},{key:"remaining_quantity",label:"Kalan",kind:"quantity"}]},
  payables: { title:"Tedarikçi Borçları",description:"Fatura, vade, ödeme ve kalan borç takibi.",question:"Kime ne kadar borçluyuz?",empty:"Tedarikçi faturası bulunmuyor.",columns:[{key:"invoice_number",label:"Fatura"},{key:"supplier",label:"Tedarikçi"},{key:"invoice_date",label:"Tarih",kind:"datetime"},{key:"due_date",label:"Vade",kind:"date"},{key:"total",label:"Toplam",kind:"money"},{key:"paid_total",label:"Ödenen",kind:"money"},{key:"remaining",label:"Kalan",kind:"money"},{key:"status",label:"Durum",kind:"status"}]},
  "price-history": { title:"Alım Fiyat Geçmişi",description:"Mal kabulünde fiilen ödenen birim fiyatlar ve bir önceki alıma göre değişim.",question:"Ne zamandan beri, ne kadar zamlandı?",empty:"Seçili aralıkta mal kabulü yok.",columns:[{key:"created_at",label:"Tarih",kind:"datetime"},{key:"item_name",label:"Stok Kalemi"},{key:"supplier",label:"Tedarikçi"},{key:"receipt_number",label:"İrsaliye"},{key:"received_quantity",label:"Miktar",kind:"quantity"},{key:"unit",label:"Birim"},{key:"previous_unit_price",label:"Önceki Fiyat",kind:"money"},{key:"unit_price",label:"Ödenen Fiyat",kind:"money"},{key:"change_percent",label:"Değişim",kind:"percent"}]},
  forecast: { title:"Yarın İçin Üretim Önerisi",description:"Son 56 gün, aynı hafta günü ve satışa kapalı gün sansürüyle sınırlı tahmin.",question:"Yarın ne kadar üretmeliyiz?",empty:"Yeterli geçmiş satış verisi yok.",columns:[{key:"product",label:"Ürün"},{key:"category",label:"Kategori"},{key:"observations",label:"Gözlem"},{key:"recent_average",label:"Yakın Ortalama",kind:"quantity"},{key:"same_weekday_average",label:"Aynı Gün Ort.",kind:"quantity"},{key:"suggested_portions",label:"Öneri",kind:"quantity"}]},
  "menu-engineering": { title:"Menü Mühendisliği",description:"30 günlük gerçek satış popülerliği ile ürün katkısını birlikte okur.",question:"Hangi ürünleri büyütmeli, hangilerini iyileştirmeliyiz?",empty:"Sınıflandırılabilecek ürün bulunmuyor.",columns:[{key:"product",label:"Ürün"},{key:"category",label:"Kategori"},{key:"sales",label:"Satış"},{key:"contribution",label:"Katkı",kind:"money"},{key:"food_cost_percent",label:"Maliyet Oranı",kind:"percent"},{key:"classification",label:"Sınıf"}]},
  popular: { title:"Popüler Ürünler",description:"Şefin önerisinden bağımsız, son 30 günlük tamamlanmış satış sıralaması.",question:"Misafirler gerçekten en çok ne söylüyor?",empty:"Henüz popüler ürün sıralaması yok.",columns:[{key:"rank",label:"Sıra"},{key:"product",label:"Ürün"},{key:"quantity_sold",label:"Satılan"},{key:"window_days",label:"Gün"},{key:"calculated_at",label:"Son Hesap",kind:"datetime"}]},
  attendance: { title:"Puantaj",description:"Personel giriş-çıkış ve çalışma saatlerini takip edin.",question:"Bugün kim çalışıyor?",empty:"Seçili aralıkta puantaj kaydı yok.",columns:[{key:"staff",label:"Personel"},{key:"business_date",label:"İş Günü",kind:"date"},{key:"clock_in_at",label:"Giriş",kind:"datetime"},{key:"clock_out_at",label:"Çıkış",kind:"datetime"},{key:"duration_minutes",label:"Süre",kind:"duration"},{key:"status",label:"Durum",kind:"status"},{key:"correction_reason",label:"Düzeltme Gerekçesi"}]},
  schedules: { title:"Vardiya Planı",description:"Haftalık personel vardiyalarını planlayın ve yönetin.",question:"Bu hafta kim, ne zaman çalışacak?",empty:"Seçili haftada vardiya planı yok.",columns:[{key:"staff",label:"Personel"},{key:"starts_at",label:"Başlangıç",kind:"datetime"},{key:"ends_at",label:"Bitiş",kind:"datetime"},{key:"role_label",label:"Görev"},{key:"location_label",label:"Konum"},{key:"status",label:"Durum",kind:"status"},{key:"notes",label:"Not"}]},
  payroll: { title:"Bordro",description:"Personel bordrolarını ve ödeme durumlarını yönetin.",question:"Bu dönemde operasyonel olarak ne ödenecek?",empty:"Operasyonel bordro kaydı yok.",columns:[{key:"staff",label:"Personel"},{key:"period_start",label:"Dönem Başlangıç",kind:"date"},{key:"period_end",label:"Dönem Sonu",kind:"date"},{key:"worked_minutes",label:"Çalışma",kind:"duration"},{key:"overtime_minutes",label:"Fazla Mesai",kind:"duration"},{key:"gross_salary",label:"Brüt",kind:"money"},{key:"allowances",label:"Ekler",kind:"money"},{key:"deductions",label:"Kesinti",kind:"money"},{key:"net_payable",label:"Net",kind:"money"},{key:"status",label:"Durum",kind:"status"}]},
  feedback: { title:"Misafir Geri Bildirimi",description:"Kimlik gerektirmeyen puanlar, yorumlar ve düşük puan uyarıları.",question:"Misafir deneyiminde neyi iyileştirmeliyiz?",empty:"Seçili aralıkta geri bildirim yok.",columns:[{key:"created_at",label:"Tarih",kind:"datetime"},{key:"rating",label:"Genel"},{key:"food_rating",label:"Yemek"},{key:"service_rating",label:"Servis"},{key:"cleanliness_rating",label:"Temizlik"},{key:"comment",label:"Yorum"},{key:"status",label:"Moderasyon",kind:"status"},{key:"low_rating",label:"Uyarı",kind:"boolean"}]},
  fulfillment: { title:"Paket ve Kurye",description:"Gel-al ve adrese teslim siparişlerin alınması ve teslim akışı.",question:"Hangi sipariş nerede, kurye ne zaman çıktı?",empty:"Seçili aralıkta paket veya kurye siparişi yok.",columns:[{key:"created_at",label:"Alındı",kind:"datetime"},{key:"channel",label:"Kanal",kind:"status"},{key:"customer_name",label:"Müşteri"},{key:"contact",label:"İletişim"},{key:"address",label:"Adres"},{key:"item_count",label:"Kalem"},{key:"lines_total",label:"Ürün Tutarı",kind:"money"},{key:"delivery_fee",label:"Teslimat Ücreti",kind:"money"},{key:"total",label:"Toplam",kind:"money"},{key:"status",label:"Durum",kind:"status"},{key:"order_number",label:"Sipariş No"},{key:"order_status",label:"Mutfak Durumu",kind:"status"},{key:"kitchen_link",label:"Mutfağa Bağlı",kind:"status"},{key:"delivery_notes",label:"Not"}],statuses:[{value:"DRAFT",label:"Taslak"},{value:"PLACED",label:"Alındı"},{value:"WAITING_FOR_COURIER",label:"Kurye Bekleniyor"},{value:"OUT_FOR_DELIVERY",label:"Yola Çıktı"},{value:"DELIVERED",label:"Teslim Edildi"},{value:"CANCELLED",label:"İptal"}]},
  reservations: { title:"Rezervasyonlar",description:"Bugün, hafta ve liste görünümüne uygun operasyonel rezervasyon akışı.",question:"Bugün kimi, ne zaman ve hangi masada ağırlıyoruz?",empty:"Seçili aralıkta rezervasyon yok.",columns:[{key:"starts_at",label:"Başlangıç",kind:"datetime"},{key:"customer_name",label:"Misafir"},{key:"phone",label:"Telefon"},{key:"party_size",label:"Kişi"},{key:"table_name",label:"Masa"},{key:"status",label:"Durum",kind:"status"},{key:"notes",label:"Not"}]},
  customers: { title:"Müşteriler",description:"İsteğe bağlı hesaplar, yalnız bağlı sipariş sayısı ve sadakat bakiyesi.",question:"Hesap açmayı seçen müşterilerimiz kim?",empty:"Müşteri hesabı yok; misafir QR akışı normal çalışıyor.",columns:[{key:"name",label:"Müşteri"},{key:"email",label:"E-posta"},{key:"phone",label:"Telefon"},{key:"linked_orders",label:"Bağlı Sipariş"},{key:"loyalty_balance",label:"Sadakat Bakiyesi"},{key:"marketing_consent",label:"İletişim İzni",kind:"boolean"},{key:"is_active",label:"Durum",kind:"boolean"}]},
  loyalty: { title:"Sadakat Programı",description:"Kazanım ve kullanım kuralı belirlenene kadar güvenli biçimde pasif.",question:"Sadakat kuralı yapılandırıldı mı?",empty:"Henüz etkin değil.",columns:[]},
  integrations: { title:"Entegrasyonlar",description:"Dış sağlayıcı bağlantılarının yapılandırma durumu; gizli değerler gösterilmez.",question:"Hangi dış sistem yapılandırıldı?",empty:"Dış sağlayıcı bağlantısı yapılandırılmamış.",columns:[{key:"kind",label:"Entegrasyon",kind:"status"},{key:"display_name",label:"Ad"},{key:"provider",label:"Sağlayıcı"},{key:"status",label:"Durum",kind:"status"},{key:"is_enabled",label:"Etkin",kind:"boolean"},{key:"updated_at",label:"Güncelleme",kind:"datetime"}]},
  reports: { title:"ERP Raporları",description:"Stok, fire, üretim, satın alma, borç ve puantajın sayfalı operasyon özeti.",question:"Operasyonun ana kayıp ve yükümlülük sinyalleri neler?",empty:"Rapor verisi bulunmuyor.",columns:[{key:"report_name",label:"Rapor"},{key:"metric",label:"Gösterge"},{key:"value",label:"Değer"},{key:"unit",label:"Birim"}]},
};

export interface ErpEmptyState {
  readonly title: string;
  readonly description: string;
  /** Null when the screen genuinely has nothing to send the user to. */
  readonly actionLabel: string | null;
  readonly actionHref: string | null;
  /** True when the screen is empty because something else must exist first. */
  readonly prerequisite: boolean;
}

/**
 * What an empty ERP screen should say.
 *
 * A blank table is a dead end: it tells a manager that something is missing but
 * not what, and not where to go. Several of these screens are empty for a
 * reason the manager cannot guess — stock items need a warehouse to live in,
 * recipes need ingredients to reference, a purchase order needs someone to buy
 * from. Those cases name the prerequisite and point at it.
 *
 * The counts come from `options`, which the read already fetched for the
 * filters, so this needs no extra query and can never disagree with the
 * database. Nothing here is hardcoded as "done".
 */
export function erpEmptyState(
  module: ErpWorkspaceModule,
  options: Readonly<Record<string, readonly Record<string, string>[]>>,
  filtered: boolean,
): ErpEmptyState {
  const count = (key: string) => (options[key] ?? []).length;
  const config = ERP_UI_CONFIG[module];

  // A list emptied by a filter is not a list with nothing in it. Saying "no
  // suppliers yet" to someone who just typed a search is simply wrong.
  if (filtered) {
    return {
      title: "Aramanızla eşleşen kayıt yok",
      description: "Farklı bir arama yapın veya filtreleri temizleyin.",
      actionLabel: null,
      actionHref: null,
      prerequisite: false,
    };
  }

  const needsWarehouse: ErpEmptyState = {
    title: "Stok ürünlerinden önce depo oluşturun",
    description: "Malzemelerin hangi depoda tutulacağı bilinmeden stok takibi başlatılamaz.",
    actionLabel: "Depo Oluştur",
    actionHref: "/admin/warehouses",
    prerequisite: true,
  };

  switch (module) {
    case "warehouses":
      return {
        title: "Henüz depo tanımlanmadı",
        description: "Stok takibine başlamak için önce malzemelerin tutulduğu yeri tanımlayın.",
        actionLabel: "Depo Ekle",
        actionHref: null,
        prerequisite: false,
      };

    case "inventory":
      if (count("warehouses") === 0) return needsWarehouse;
      return {
        title: "Henüz stok ürünü eklenmedi",
        description: "Takip etmek istediğiniz malzemeleri ekleyin; miktarlar stok hareketlerinden hesaplanır.",
        actionLabel: "Stok Ürünü Ekle",
        actionHref: null,
        prerequisite: false,
      };

    case "stock-movements":
      if (count("inventoryItems") === 0) {
        return {
          title: "Stok hareketi için önce stok ürünü ekleyin",
          description: "Hareketler, tanımlı stok ürünleri üzerinden kaydedilir.",
          actionLabel: "Stok Ürünlerine Git",
          actionHref: "/admin/inventory",
          prerequisite: true,
        };
      }
      return { title: config.empty, description: "Seçili tarih aralığında hareket bulunmuyor.", actionLabel: null, actionHref: null, prerequisite: false };

    case "suppliers":
      return {
        title: "Henüz tedarikçi eklenmedi",
        description: "Satın alma ve mal kabul işlemleri için tedarikçilerinizi tanımlayın.",
        actionLabel: "Tedarikçi Ekle",
        actionHref: null,
        prerequisite: false,
      };

    case "recipes":
    case "costing":
      if (count("inventoryItems") === 0) {
        return {
          title: "Reçete oluşturmadan önce stok ürünlerini tanımlayın",
          description: "Bir reçete, tanımlı malzemelerden ne kadar kullanıldığını anlatır.",
          actionLabel: "Stok Ürünlerine Git",
          actionHref: "/admin/inventory",
          prerequisite: true,
        };
      }
      return {
        title: "Henüz reçete oluşturulmadı",
        description: "Ürünlerinizin hangi malzemelerden hazırlandığını tanımlayın.",
        actionLabel: "Reçete Oluştur",
        actionHref: module === "costing" ? "/admin/recipes" : null,
        prerequisite: false,
      };

    case "purchasing":
      if (count("suppliers") === 0) {
        return {
          title: "Satın alma işlemi için önce tedarikçi ekleyin",
          description: "Sipariş verilecek tedarikçi tanımlı değilken satın alma oluşturulamaz.",
          actionLabel: "Tedarikçi Ekle",
          actionHref: "/admin/suppliers",
          prerequisite: true,
        };
      }
      return {
        title: "Henüz satın alma siparişi yok",
        description: "Tedarikçiye vereceğiniz siparişi buradan oluşturun.",
        actionLabel: "Satın Alma Oluştur",
        actionHref: null,
        prerequisite: false,
      };

    case "production":
      if (count("recipes") === 0) {
        return {
          title: "Üretim kaydı için önce reçetelerinizi tanımlayın",
          description: "Üretim, aktif bir reçeteye göre malzemeleri stoktan düşer.",
          actionLabel: "Reçetelere Git",
          actionHref: "/admin/recipes",
          prerequisite: true,
        };
      }
      return { title: config.empty, description: "Seçili aralıkta üretim planı bulunmuyor.", actionLabel: null, actionHref: null, prerequisite: false };

    case "waste":
      if (count("inventoryItems") === 0) {
        return {
          title: "Fire kaydı için önce stok ürünlerini tanımlayın",
          description: "Fire, tanımlı bir stok ürününden düşülür.",
          actionLabel: "Stok Ürünlerine Git",
          actionHref: "/admin/inventory",
          prerequisite: true,
        };
      }
      return { title: config.empty, description: "Seçili aralıkta fire kaydı bulunmuyor.", actionLabel: null, actionHref: null, prerequisite: false };

    default:
      return { title: config.empty, description: "Bu ekranda gösterilecek kayıt bulunmuyor.", actionLabel: null, actionHref: null, prerequisite: false };
  }
}
