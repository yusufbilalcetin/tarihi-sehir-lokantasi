export type MenuLanguage = "tr" | "en" | "de" | "ar";
export type MenuCurrency = "TRY" | "USD" | "EUR";
export type LocalizedText = string | Partial<Record<MenuLanguage, string>>;

const tr = {
  menu: "Menü",
  search: "Menüde ara...",
  searchLabel: "Menüde ara",
  categories: "Kategoriler",
  categoryIntro: "Sofranıza yakışan lezzeti seçin.",
  categoryNavigation: "Menü kategorileri",
  openCategory: "{name} kategorisini aç, {count} ürün",
  items: "ürün",
  item: "ürün",
  searchResults: "Arama Sonuçları",
  productsFound: "{count} ürün bulundu",
  backToCategories: "Kategorilere dön",
  backToCategory: "{name} listesine dön",
  clearSearch: "Aramayı temizle",
  noResults: "Eşleşen ürün bulunamadı",
  noResultsDescription: "Arama kelimenizi değiştirin veya kategorilere dönün.",
  order: "Siparişim",
  waiter: "Garson",
  bill: "Hesap",
  addToCart: "Sepete Ekle",
  addedToCart: "{name} sepete eklendi.",
  removeFromCart: "{name} ürününü kaldır",
  soldOut: "Bugün Tükendi",
  productDetails: "{name} detayını aç",
  portion: "Porsiyon",
  standardPortion: "Standart porsiyon",
  allergens: "Alerjenler",
  noAllergens: "Bildirilmiş alerjen yok",
  productNote: "Ürün notu",
  productNotePlaceholder: "Örn. tereyağsız olsun",
  decreaseQuantity: "Adedi azalt",
  increaseQuantity: "Adedi artır",
  each: "adet",
  note: "Not",
  subtotal: "Ara toplam",
  serviceFee: "Servis ücreti",
  total: "Genel toplam",
  sendOrder: "Siparişi Gönder",
  orderSent: "Siparişiniz mutfağa iletildi",
  orderTracking: "#{number} numaralı siparişinizi buradan takip edebilirsiniz.",
  newItem: "Yeni Ürün Ekle",
  emptyCart: "Sepetiniz henüz boş",
  emptyCartDescription: "Menüden seçtiğiniz ürünler burada görünecek.",
  browseMenu: "Menüyü İncele",
  orderReceived: "Sipariş Alındı",
  waiterConfirmed: "Garson Onayladı",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  served: "Servis Edildi",
  preparingDescription: "Mutfağımız siparişinizi hazırlıyor.",
  orderStatus: "Sipariş durumu",
  callWaiter: "Garson çağır",
  placeOrder: "Sipariş vereceğim",
  wantWater: "Su istiyorum",
  wantBread: "Ekmek istiyorum",
  wantService: "Ek servis istiyorum",
  other: "Diğer",
  generalRequest: "Genel bir talebim var",
  orderHelp: "Siparişim için yardım istiyorum",
  waterDescription: "Masaya su rica ediyorum",
  breadDescription: "Ekmek servisi rica ediyorum",
  serviceDescription: "Çatal, kaşık veya tabak istiyorum",
  otherDescription: "Farklı bir konuda yardıma ihtiyacım var",
  waiterHelpTitle: "Size nasıl yardımcı olabiliriz?",
  waiterHelpDescription: "Talebiniz {table} bilgisiyle garson ekranına iletilir.",
  waiterRequestSent: "Talebiniz garsonumuza iletildi.",
  requestBill: "Hesabı İste",
  billSent: "Hesap talebiniz iletildi",
  billConfirm: "Hesabı istemek istediğinize emin misiniz?",
  billSentDescription: "Garsonumuz kısa süre içinde masanızla ilgilenecek.",
  billConfirmDescription: "Talebiniz doğrudan garson ekranına düşecek. Ödemeyi kasada veya masada yapabilirsiniz.",
  billToast: "Hesap talebiniz garsonumuza iletildi.",
  backToMenu: "Menüye Dön",
  back: "Geri",
  close: "Kapat",
  yourTable: "MASANIZ",
  serviceOpen: "Servis açık",
  slogan: "Eski Usul • Yeni Nesil Lezzetler",
  location: "Bursa, Osmangazi",
  languageLabel: "Dil seç",
  currencyLabel: "Para birimi seç",
  customerNavigation: "Müşteri menü navigasyonu",
  approximateCurrency: "Döviz fiyatları bilgi amaçlı yaklaşık karşılıklardır. Ödeme Türk Lirası üzerinden yapılır.",
  orderSuccess: "Siparişiniz başarıyla gönderildi.",
} as const;

export type MenuTranslationKey = keyof typeof tr;
type TranslationDictionary = Record<MenuTranslationKey, string>;

export const menuTranslations: Record<MenuLanguage, TranslationDictionary> = {
  tr,
  en: {
    menu: "Menu", search: "Search the menu...", searchLabel: "Search the menu", categories: "Categories", categoryIntro: "Choose the flavour for your table.", categoryNavigation: "Menu categories", openCategory: "Open {name}, {count} items", items: "items", item: "item", searchResults: "Search Results", productsFound: "{count} items found", backToCategories: "Back to categories", backToCategory: "Back to {name}", clearSearch: "Clear search", noResults: "No matching items found", noResultsDescription: "Try another search or return to the categories.", order: "My Order", waiter: "Waiter", bill: "Bill", addToCart: "Add to Order", addedToCart: "{name} added to your order.", removeFromCart: "Remove {name}", soldOut: "Sold Out Today", productDetails: "Open details for {name}", portion: "Portion", standardPortion: "Standard portion", allergens: "Allergens", noAllergens: "No declared allergens", productNote: "Item note", productNotePlaceholder: "E.g. no butter, please", decreaseQuantity: "Decrease quantity", increaseQuantity: "Increase quantity", each: "each", note: "Note", subtotal: "Subtotal", serviceFee: "Service fee", total: "Total", sendOrder: "Send Order", orderSent: "Your order was sent to the kitchen", orderTracking: "Track order #{number} here.", newItem: "Add Another Item", emptyCart: "Your order is empty", emptyCartDescription: "Items you choose from the menu will appear here.", browseMenu: "Browse Menu", orderReceived: "Order Received", waiterConfirmed: "Waiter Confirmed", preparing: "Preparing", ready: "Ready", served: "Served", preparingDescription: "Our kitchen is preparing your order.", orderStatus: "Order status", callWaiter: "Call Waiter", placeOrder: "I want to order", wantWater: "I would like water", wantBread: "I would like bread", wantService: "Extra service", other: "Other", generalRequest: "I have a general request", orderHelp: "I need help with my order", waterDescription: "Please bring water to the table", breadDescription: "Please bring bread to the table", serviceDescription: "I need cutlery or a plate", otherDescription: "I need help with something else", waiterHelpTitle: "How can we help?", waiterHelpDescription: "Your request will be sent with {table}.", waiterRequestSent: "Your request was sent to our waiter.", requestBill: "Request Bill", billSent: "Your bill request was sent", billConfirm: "Would you like to request the bill?", billSentDescription: "Our waiter will be with you shortly.", billConfirmDescription: "Your request will go directly to the waiter. You may pay at the table or cashier.", billToast: "Your bill request was sent to our waiter.", backToMenu: "Back to Menu", back: "Back", close: "Close", yourTable: "YOUR TABLE", serviceOpen: "Service open", slogan: "Traditional Taste • Modern Table", location: "Bursa, Osmangazi", languageLabel: "Select language", currencyLabel: "Select currency", customerNavigation: "Customer menu navigation", approximateCurrency: "Foreign currency prices are approximate. Payment is processed in Turkish Lira.", orderSuccess: "Your order was sent successfully.",
  },
  de: {
    menu: "Menü", search: "Menü durchsuchen...", searchLabel: "Menü durchsuchen", categories: "Kategorien", categoryIntro: "Wählen Sie den passenden Geschmack für Ihren Tisch.", categoryNavigation: "Menükategorien", openCategory: "{name} öffnen, {count} Artikel", items: "Artikel", item: "Artikel", searchResults: "Suchergebnisse", productsFound: "{count} Artikel gefunden", backToCategories: "Zurück zu den Kategorien", backToCategory: "Zurück zu {name}", clearSearch: "Suche löschen", noResults: "Keine passenden Artikel gefunden", noResultsDescription: "Ändern Sie Ihre Suche oder kehren Sie zu den Kategorien zurück.", order: "Meine Bestellung", waiter: "Kellner", bill: "Rechnung", addToCart: "Hinzufügen", addedToCart: "{name} wurde hinzugefügt.", removeFromCart: "{name} entfernen", soldOut: "Heute ausverkauft", productDetails: "Details zu {name} öffnen", portion: "Portion", standardPortion: "Standardportion", allergens: "Allergene", noAllergens: "Keine Allergene angegeben", productNote: "Produktnotiz", productNotePlaceholder: "Z. B. bitte ohne Butter", decreaseQuantity: "Menge verringern", increaseQuantity: "Menge erhöhen", each: "Stück", note: "Notiz", subtotal: "Zwischensumme", serviceFee: "Servicegebühr", total: "Gesamtsumme", sendOrder: "Bestellung senden", orderSent: "Ihre Bestellung wurde an die Küche gesendet", orderTracking: "Bestellung #{number} können Sie hier verfolgen.", newItem: "Weiteren Artikel hinzufügen", emptyCart: "Ihre Bestellung ist leer", emptyCartDescription: "Ausgewählte Artikel erscheinen hier.", browseMenu: "Menü ansehen", orderReceived: "Bestellung eingegangen", waiterConfirmed: "Vom Kellner bestätigt", preparing: "Wird zubereitet", ready: "Fertig", served: "Serviert", preparingDescription: "Unsere Küche bereitet Ihre Bestellung zu.", orderStatus: "Bestellstatus", callWaiter: "Kellner rufen", placeOrder: "Ich möchte bestellen", wantWater: "Ich möchte Wasser", wantBread: "Ich möchte Brot", wantService: "Zusätzliches Gedeck", other: "Sonstiges", generalRequest: "Ich habe eine allgemeine Bitte", orderHelp: "Ich benötige Hilfe bei der Bestellung", waterDescription: "Bitte Wasser an den Tisch bringen", breadDescription: "Bitte Brot an den Tisch bringen", serviceDescription: "Ich benötige Besteck oder einen Teller", otherDescription: "Ich benötige anderweitige Hilfe", waiterHelpTitle: "Wie können wir helfen?", waiterHelpDescription: "Ihre Anfrage wird mit {table} übermittelt.", waiterRequestSent: "Ihre Anfrage wurde an unseren Kellner gesendet.", requestBill: "Rechnung anfordern", billSent: "Ihre Rechnungsanfrage wurde gesendet", billConfirm: "Möchten Sie die Rechnung anfordern?", billSentDescription: "Unser Kellner kommt in Kürze zu Ihnen.", billConfirmDescription: "Ihre Anfrage geht direkt an den Kellner. Sie können am Tisch oder an der Kasse zahlen.", billToast: "Ihre Rechnungsanfrage wurde an unseren Kellner gesendet.", backToMenu: "Zurück zum Menü", back: "Zurück", close: "Schließen", yourTable: "IHR TISCH", serviceOpen: "Service geöffnet", slogan: "Traditioneller Geschmack • Moderner Tisch", location: "Bursa, Osmangazi", languageLabel: "Sprache auswählen", currencyLabel: "Währung auswählen", customerNavigation: "Kundennavigation", approximateCurrency: "Fremdwährungspreise sind Richtwerte. Die Zahlung erfolgt in Türkischer Lira.", orderSuccess: "Ihre Bestellung wurde erfolgreich gesendet.",
  },
  ar: {
    menu: "القائمة", search: "ابحث في القائمة...", searchLabel: "البحث في القائمة", categories: "التصنيفات", categoryIntro: "اختر النكهة المناسبة لمائدتك.", categoryNavigation: "تصنيفات القائمة", openCategory: "فتح {name}، {count} صنف", items: "صنف", item: "صنف", searchResults: "نتائج البحث", productsFound: "تم العثور على {count} صنف", backToCategories: "العودة إلى التصنيفات", backToCategory: "العودة إلى {name}", clearSearch: "مسح البحث", noResults: "لم يتم العثور على نتائج", noResultsDescription: "غيّر عبارة البحث أو عد إلى التصنيفات.", order: "طلبي", waiter: "النادل", bill: "الحساب", addToCart: "أضف إلى الطلب", addedToCart: "تمت إضافة {name} إلى طلبك.", removeFromCart: "إزالة {name}", soldOut: "نفد اليوم", productDetails: "فتح تفاصيل {name}", portion: "الحصة", standardPortion: "حصة عادية", allergens: "مسببات الحساسية", noAllergens: "لا توجد مسببات حساسية معلنة", productNote: "ملاحظة المنتج", productNotePlaceholder: "مثال: بدون زبدة من فضلك", decreaseQuantity: "تقليل الكمية", increaseQuantity: "زيادة الكمية", each: "للقطعة", note: "ملاحظة", subtotal: "المجموع الفرعي", serviceFee: "رسوم الخدمة", total: "المجموع", sendOrder: "إرسال الطلب", orderSent: "تم إرسال طلبك إلى المطبخ", orderTracking: "يمكنك متابعة الطلب رقم #{number} هنا.", newItem: "إضافة منتج آخر", emptyCart: "طلبك فارغ", emptyCartDescription: "ستظهر هنا المنتجات التي تختارها من القائمة.", browseMenu: "تصفح القائمة", orderReceived: "تم استلام الطلب", waiterConfirmed: "أكد النادل", preparing: "قيد التحضير", ready: "جاهز", served: "تم التقديم", preparingDescription: "يقوم مطبخنا بتحضير طلبك.", orderStatus: "حالة الطلب", callWaiter: "استدعاء النادل", placeOrder: "أريد الطلب", wantWater: "أريد ماء", wantBread: "أريد خبزًا", wantService: "خدمة إضافية", other: "أخرى", generalRequest: "لدي طلب عام", orderHelp: "أحتاج مساعدة في طلبي", waterDescription: "يرجى إحضار الماء إلى الطاولة", breadDescription: "يرجى إحضار الخبز إلى الطاولة", serviceDescription: "أحتاج أدوات مائدة أو طبقًا", otherDescription: "أحتاج مساعدة في أمر آخر", waiterHelpTitle: "كيف يمكننا مساعدتك؟", waiterHelpDescription: "سيتم إرسال طلبك مع بيانات {table}.", waiterRequestSent: "تم إرسال طلبك إلى النادل.", requestBill: "طلب الحساب", billSent: "تم إرسال طلب الحساب", billConfirm: "هل تريد طلب الحساب؟", billSentDescription: "سيهتم النادل بطاولتك قريبًا.", billConfirmDescription: "سيصل طلبك مباشرة إلى النادل. يمكنك الدفع على الطاولة أو عند الصندوق.", billToast: "تم إرسال طلب الحساب إلى النادل.", backToMenu: "العودة إلى القائمة", back: "رجوع", close: "إغلاق", yourTable: "طاولتك", serviceOpen: "الخدمة متاحة", slogan: "مذاق تقليدي • مائدة عصرية", location: "بورصة، عثمان غازي", languageLabel: "اختر اللغة", currencyLabel: "اختر العملة", customerNavigation: "التنقل في قائمة العميل", approximateCurrency: "الأسعار بالعملات الأجنبية تقريبية. يتم الدفع بالليرة التركية.", orderSuccess: "تم إرسال طلبك بنجاح.",
  },
};

export function getLocalizedText(value: LocalizedText, language: MenuLanguage) {
  if (typeof value === "string") return value;
  return value[language] ?? value.tr ?? Object.values(value).find(Boolean) ?? "";
}

export function translateMenu(
  language: MenuLanguage,
  key: MenuTranslationKey,
  values?: Record<string, string | number>,
) {
  let translated: string = menuTranslations[language][key];
  if (!values) return translated;
  for (const [name, value] of Object.entries(values)) {
    translated = translated.replaceAll(`{${name}}`, String(value));
  }
  return translated;
}
