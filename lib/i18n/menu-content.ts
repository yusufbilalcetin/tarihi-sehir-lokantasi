import type { Category, Product } from "@/types";
import {
  getLocalizedText,
  type LocalizedText,
  type MenuLanguage,
} from "./menu-translations";
import { getLoadedMenuCatalog } from "./menu-catalog";
import { getMenuLanguage } from "./languages";

export const categoryNames: Record<string, LocalizedText> = {
  soups: { tr: "Çorbalar", en: "Soups", de: "Suppen", ar: "الشوربات" },
  grill: { tr: "Izgaralar", en: "Grills", de: "Grillgerichte", ar: "المشويات" },
  mains: { tr: "Ana Yemekler", en: "Main Courses", de: "Hauptgerichte", ar: "الأطباق الرئيسية" },
  drinks: { tr: "İçecekler", en: "Drinks", de: "Getränke", ar: "المشروبات" },
  kebabs: { tr: "Kebaplar", en: "Kebabs", de: "Kebabs", ar: "الكباب" },
  dessert: { tr: "Tatlılar", en: "Desserts", de: "Desserts", ar: "الحلويات" },
};

export const productNames: Record<string, LocalizedText> = {
  mercimek: { tr: "Mercimek Çorbası", en: "Lentil Soup", de: "Linsensuppe", ar: "شوربة العدس" },
  "tas-kebabi": { tr: "Tas Kebabı", en: "Turkish Beef Stew", de: "Türkischer Rinderschmortopf", ar: "طاجن لحم تركي" },
  "kuzu-tandir": { tr: "Kuzu Tandır", en: "Slow-Roasted Lamb", de: "Langsam gegartes Lamm", ar: "لحم ضأن مطهو ببطء" },
  "pirinc-pilavi": { tr: "Pirinç Pilavı", en: "Rice Pilaf", de: "Reispilaw", ar: "أرز بيلاف" },
  "firin-sutlac": { tr: "Fırın Sütlaç", en: "Baked Rice Pudding", de: "Gebackener Milchreis", ar: "أرز بالحليب مخبوز" },
  "kuru-fasulye": { tr: "Etli Kuru Fasulye", en: "White Bean Stew with Beef", de: "Bohneneintopf mit Rind", ar: "فاصوليا بيضاء باللحم" },
  "izgara-kofte": { tr: "Izgara Köfte", en: "Grilled Meatballs", de: "Gegrillte Köfte", ar: "كفتة مشوية" },
  ayran: { tr: "Yayık Ayranı", en: "Churned Ayran", de: "Hausgemachter Ayran", ar: "عيران مخفوق" },
  "ezogelin-corbasi": { tr: "Ezogelin Çorbası", en: "Ezogelin Soup", de: "Ezogelin-Suppe", ar: "شوربة إيزوغيلين" },
  "tarhana-corbasi": { tr: "Tarhana Çorbası", en: "Tarhana Soup", de: "Tarhana-Suppe", ar: "شوربة ترهانا" },
  "yayla-corbasi": { tr: "Yayla Çorbası", en: "Yogurt and Rice Soup", de: "Joghurt-Reis-Suppe", ar: "شوربة اللبن والأرز" },
  "iskembe-corbasi": { tr: "İşkembe Çorbası", en: "Tripe Soup", de: "Kuttelsuppe", ar: "شوربة الكرشة" },
  "dugun-corbasi": { tr: "Düğün Çorbası", en: "Wedding Soup", de: "Türkische Hochzeitssuppe", ar: "شوربة الزفاف التركية" },
  "tavuk-suyu-corbasi": { tr: "Tavuk Suyu Çorbası", en: "Chicken Broth Soup", de: "Hühnerbrühe", ar: "شوربة مرق الدجاج" },
  "domates-corbasi": { tr: "Domates Çorbası", en: "Tomato Soup", de: "Tomatensuppe", ar: "شوربة الطماطم" },
  "sebze-corbasi": { tr: "Sebze Çorbası", en: "Vegetable Soup", de: "Gemüsesuppe", ar: "شوربة الخضار" },
  "beyran-corbasi": { tr: "Beyran Çorbası", en: "Spicy Lamb Beyran Soup", de: "Scharfe Beyran-Lammsuppe", ar: "شوربة بيران بالضأن" },
  "kelle-paca-corbasi": { tr: "Kelle Paça Çorbası", en: "Head and Trotter Soup", de: "Kopf- und Fußsuppe", ar: "شوربة الكوارع والرأس" },
  "sehriye-corbasi": { tr: "Şehriye Çorbası", en: "Vermicelli Soup", de: "Nudelsuppe", ar: "شوربة الشعيرية" },
  "tavuk-sis": { tr: "Tavuk Şiş", en: "Chicken Skewers", de: "Hähnchenspieße", ar: "شيش طاووق" },
  "kasap-sucuk": { tr: "Kasap Sucuk", en: "Grilled Butcher's Sucuk", de: "Gegrillte Sucuk", ar: "سجق مشوي" },
  "karisik-izgara": { tr: "Karışık Izgara", en: "Mixed Grill", de: "Gemischter Grillteller", ar: "مشاوي مشكلة" },
  "nohut-yemegi": { tr: "Etli Nohut Yemeği", en: "Chickpea Stew with Beef", de: "Kichererbseneintopf mit Rind", ar: "حمص مطهو باللحم" },
  "patlican-musakka": { tr: "Patlıcan Musakka", en: "Eggplant Moussaka", de: "Auberginen-Moussaka", ar: "مسقعة الباذنجان" },
  "zeytinyagli-taze-fasulye": { tr: "Zeytinyağlı Taze Fasulye", en: "Green Beans in Olive Oil", de: "Grüne Bohnen in Olivenöl", ar: "فاصوليا خضراء بزيت الزيتون" },
  "tavuk-sote": { tr: "Tavuk Sote", en: "Sautéed Chicken", de: "Hähnchenpfanne", ar: "دجاج سوتيه" },
  "izmir-kofte": { tr: "İzmir Köfte", en: "İzmir-Style Meatballs", de: "Köfte nach İzmir-Art", ar: "كفتة إزمير" },
  "etli-bezelye": { tr: "Etli Bezelye", en: "Peas with Beef", de: "Erbsen mit Rindfleisch", ar: "بازلاء باللحم" },
  "patlican-oturtma": { tr: "Patlıcan Oturtma", en: "Baked Eggplant with Mince", de: "Auberginenauflauf mit Hackfleisch", ar: "باذنجان باللحم المفروم" },
  "salgam-suyu": { tr: "Şalgam Suyu", en: "Fermented Turnip Juice", de: "Fermentierter Rübensaft", ar: "عصير اللفت المخمر" },
  "maden-suyu": { tr: "Maden Suyu", en: "Mineral Water", de: "Mineralwasser", ar: "مياه معدنية" },
  su: { tr: "Doğal Kaynak Suyu", en: "Natural Spring Water", de: "Natürliches Quellwasser", ar: "مياه ينابيع طبيعية" },
  kola: { tr: "Kola", en: "Cola", de: "Cola", ar: "كولا" },
  gazoz: { tr: "Sade Gazoz", en: "Turkish Lemon Soda", de: "Türkische Limonade", ar: "مشروب غازي تركي" },
  "turk-kahvesi": { tr: "Türk Kahvesi", en: "Turkish Coffee", de: "Türkischer Kaffee", ar: "قهوة تركية" },
  "demleme-cay": { tr: "Demleme Çay", en: "Turkish Brewed Tea", de: "Türkischer Tee", ar: "شاي تركي" },
  "ev-yapimi-limonata": { tr: "Ev Yapımı Limonata", en: "Homemade Lemonade", de: "Hausgemachte Limonade", ar: "ليموناضة منزلية" },
  hosaf: { tr: "Günlük Hoşaf", en: "Daily Fruit Compote", de: "Tägliches Fruchtkompott", ar: "شراب فواكه يومي" },
  "iskender-kebabi": { tr: "Bursa İskender Kebabı", en: "Bursa İskender Kebab", de: "Bursa İskender Kebab", ar: "كباب إسكندر البورصوي" },
  kazandibi: { tr: "Kazandibi", en: "Caramelised Milk Pudding", de: "Karamellisierter Milchpudding", ar: "مهلبية محروقة" },
  "tavuk-gogsu": { tr: "Tavuk Göğsü", en: "Ottoman Milk Pudding", de: "Osmanischer Milchpudding", ar: "مهلبية صدر الدجاج" },
  keskul: { tr: "Keşkül", en: "Almond Milk Pudding", de: "Mandel-Milchpudding", ar: "مهلبية اللوز" },
  "irmik-helvasi": { tr: "İrmik Helvası", en: "Semolina Halva", de: "Grießhalva", ar: "حلاوة السميد" },
  "kabak-tatlisi": { tr: "Tahinli Kabak Tatlısı", en: "Pumpkin Dessert with Tahini", de: "Kürbisdessert mit Tahini", ar: "حلوى اليقطين بالطحينة" },
  "ayva-tatlisi": { tr: "Ayva Tatlısı", en: "Quince Dessert", de: "Quittendessert", ar: "حلوى السفرجل" },
  revani: { tr: "Revani", en: "Semolina Syrup Cake", de: "Revani-Grießkuchen", ar: "كعكة السميد بالقطر" },
  "ekmek-kadayifi": { tr: "Kaymaklı Ekmek Kadayıfı", en: "Bread Pudding with Clotted Cream", de: "Brotpudding mit Kaymak", ar: "كنافة الخبز بالقشطة" },
  "cevizli-baklava": { tr: "Cevizli Baklava", en: "Walnut Baklava", de: "Walnuss-Baklava", ar: "بقلاوة بالجوز" },
};

const descriptionTemplates: Record<string, string> = {
  en: "{name}, prepared daily in our traditional Turkish restaurant style.",
  de: "{name}, täglich nach traditioneller türkischer Art zubereitet.",
  ar: "{name}، يُحضّر يوميًا على الطريقة التركية التقليدية.",
};

export const tagTranslations: Record<string, LocalizedText> = {
  "Popüler": { tr: "Popüler", en: "Popular", de: "Beliebt", ar: "شائع" },
  "Vejetaryen": { tr: "Vejetaryen", en: "Vegetarian", de: "Vegetarisch", ar: "نباتي" },
  "Günün Yemeği": { tr: "Günün Yemeği", en: "Dish of the Day", de: "Tagesgericht", ar: "طبق اليوم" },
  "Şefin Önerisi": { tr: "Şefin Önerisi", en: "Chef's Choice", de: "Empfehlung des Küchenchefs", ar: "اختيار الشيف" },
  "Yeni": { tr: "Yeni", en: "New", de: "Neu", ar: "جديد" },
  "Acılı": { tr: "Acılı", en: "Spicy", de: "Scharf", ar: "حار" },
  "Ev Yapımı": { tr: "Ev Yapımı", en: "Homemade", de: "Hausgemacht", ar: "منزلي" },
  "Lokanta Klasiği": { tr: "Lokanta Klasiği", en: "Restaurant Classic", de: "Restaurantklassiker", ar: "طبق كلاسيكي" },
  "Günün Çorbası": { tr: "Günün Çorbası", en: "Soup of the Day", de: "Tagessuppe", ar: "شوربة اليوم" },
  "Vegan": { tr: "Vegan", en: "Vegan", de: "Vegan", ar: "نباتي صرف" },
  "Hafif": { tr: "Hafif", en: "Light", de: "Leicht", ar: "خفيف" },
  "Yöresel": { tr: "Yöresel", en: "Regional", de: "Regional", ar: "محلي" },
  "Paylaşmalık": { tr: "Paylaşmalık", en: "To Share", de: "Zum Teilen", ar: "للمشاركة" },
  "Ev Yemeği": { tr: "Ev Yemeği", en: "Home-Style", de: "Hausmannskost", ar: "طبخ منزلي" },
  "Zeytinyağlı": { tr: "Zeytinyağlı", en: "Olive Oil", de: "Mit Olivenöl", ar: "بزيت الزيتون" },
  "Nostaljik": { tr: "Nostaljik", en: "Nostalgic", de: "Nostalgisch", ar: "تراثي" },
  "Geleneksel": { tr: "Geleneksel", en: "Traditional", de: "Traditionell", ar: "تقليدي" },
  "Bursa Lezzeti": { tr: "Bursa Lezzeti", en: "Taste of Bursa", de: "Geschmack von Bursa", ar: "نكهة بورصة" },
  "Sütlü Tatlı": { tr: "Sütlü Tatlı", en: "Milk Dessert", de: "Milchdessert", ar: "حلوى بالحليب" },
  "Sıcak Tatlı": { tr: "Sıcak Tatlı", en: "Warm Dessert", de: "Warmes Dessert", ar: "حلوى ساخنة" },
  "Mevsimlik": { tr: "Mevsimlik", en: "Seasonal", de: "Saisonal", ar: "موسمي" },
  "Şerbetli": { tr: "Şerbetli", en: "Syrup Dessert", de: "Sirupdessert", ar: "حلوى بالقطر" },
};

export const allergenTranslations: Record<string, LocalizedText> = {
  "Süt ürünleri": { tr: "Süt ürünleri", en: "Dairy", de: "Milchprodukte", ar: "منتجات الألبان" },
  Gluten: { tr: "Gluten", en: "Gluten", de: "Gluten", ar: "الغلوتين" },
  Yumurta: { tr: "Yumurta", en: "Egg", de: "Ei", ar: "البيض" },
  Badem: { tr: "Badem", en: "Almond", de: "Mandel", ar: "اللوز" },
  "Çam fıstığı": { tr: "Çam fıstığı", en: "Pine nut", de: "Pinienkern", ar: "الصنوبر" },
  Susam: { tr: "Susam", en: "Sesame", de: "Sesam", ar: "السمسم" },
  Ceviz: { tr: "Ceviz", en: "Walnut", de: "Walnuss", ar: "الجوز" },
};

export function getMenuCategoryName(category: Category, language: MenuLanguage) {
  const catalogName = getLoadedMenuCatalog(language)?.categories[category.id];
  if (catalogName) return catalogName;
  return getLocalizedText(categoryNames[category.id] ?? category.name, language);
}

export function getMenuProductName(product: Product, language: MenuLanguage) {
  const catalogName = getLoadedMenuCatalog(language)?.products[product.id]?.name;
  if (catalogName) return catalogName;
  return getLocalizedText(productNames[product.id] ?? product.name, language);
}

export function getMenuProductDescription(product: Product, language: MenuLanguage) {
  const catalogDescription = getLoadedMenuCatalog(language)?.products[product.id]?.description;
  if (catalogDescription) return catalogDescription;
  if (language === "tr") return product.description;
  const baseLanguage = language.split("-")[0] ?? language;
  const template = descriptionTemplates[language] ?? descriptionTemplates[baseLanguage] ?? descriptionTemplates.en;
  return template.replace(
    "{name}",
    getMenuProductName(product, language),
  );
}

export function getMenuTag(tag: string, language: MenuLanguage) {
  const catalogTag = getLoadedMenuCatalog(language)?.tags[tag];
  if (catalogTag) return catalogTag;
  return getLocalizedText(tagTranslations[tag] ?? tag, language);
}

export function getMenuAllergen(allergen: string, language: MenuLanguage) {
  const catalogAllergen = getLoadedMenuCatalog(language)?.allergens[allergen];
  if (catalogAllergen) return catalogAllergen;
  return getLocalizedText(allergenTranslations[allergen] ?? allergen, language);
}

export function getMenuWeight(weight: string, language: MenuLanguage) {
  const match = weight.trim().match(/^(\d+(?:[.,]\d+)?)\s*(gr|g|ml)$/i);
  if (!match) return weight;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toLocaleLowerCase("en-US") === "ml" ? "milliliter" : "gram";
  return new Intl.NumberFormat(getMenuLanguage(language)?.locale ?? "tr-TR", {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
}
