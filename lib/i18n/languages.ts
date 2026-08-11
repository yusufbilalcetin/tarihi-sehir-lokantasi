import { SUPPORTED_MENU_LOCALE_SET } from "./supported-locales";

export type MenuLanguage = string;
export type MenuTextDirection = "ltr" | "rtl";

export interface MenuLanguageDefinition {
  code: MenuLanguage;
  baseCode: string;
  locale: string;
  nativeName: string;
  turkishName: string;
  englishName: string;
  direction: MenuTextDirection;
  flag: {
    emoji: string;
    countryCode: string | null;
  };
  searchTerms: string[];
  popular?: boolean;
}

export const DEFAULT_MENU_LANGUAGE = "tr";

const ISO_639_1_CODES = (
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu"
).split(" ");

export const ISO_639_1_LANGUAGE_COUNT = ISO_639_1_CODES.length;

const POPULAR_LANGUAGE_CODES = ["tr", "en", "ar", "de", "ru", "fr", "es", "fa"];
const RTL_LANGUAGE_CODES = new Set(["ar", "dv", "fa", "ps", "sd", "ug", "ur", "yi"]);

const LOCALE_OVERRIDES: Record<string, string> = {
  ar: "ar-SA", de: "de-DE", en: "en-GB", es: "es-ES", fa: "fa-IR",
  fr: "fr-FR", hi: "hi-IN", ja: "ja-JP", ko: "ko-KR",
  pt: "pt-PT", ru: "ru-RU", tr: "tr-TR", uk: "uk-UA", ur: "ur-PK",
  vi: "vi-VN",
};

const NATIVE_NAME_OVERRIDES: Record<string, string> = {
  am: "አማርኛ", ar: "العربية", az: "Azərbaycan dili", be: "Беларуская",
  bn: "বাংলা", bs: "Bosanski", de: "Deutsch", el: "Ελληνικά", en: "English",
  es: "Español", fa: "فارسی", fr: "Français", gu: "ગુજરાતી",
  hi: "हिन्दी", hy: "Հայերեն", id: "Bahasa Indonesia", ja: "日本語",
  ka: "ქართული", kk: "Қазақ тілі", km: "ភាសាខ្មែរ", kn: "ಕನ್ನಡ", ko: "한국어",
  ky: "Кыргызча", lo: "ລາວ", mk: "Македонски", ml: "മലയാളം",
  mn: "Монгол", mr: "मराठी", ms: "Bahasa Melayu", my: "မြန်မာ", ne: "नेपाली",
  pa: "ਪੰਜਾਬੀ", ru: "Русский", si: "සිංහල", sr: "Српски", ta: "தமிழ்",
  te: "తెలుగు", tg: "Тоҷикӣ", th: "ไทย", tk: "Türkmençe", tl: "Filipino / Tagalog",
  tr: "Türkçe", uk: "Українська", ur: "اردو", uz: "Oʻzbekcha", vi: "Tiếng Việt",
};

const TURKISH_NAME_OVERRIDES: Record<string, string> = {
  ar: "Arapça", de: "Almanca", en: "İngilizce", es: "İspanyolca", fa: "Farsça",
  fr: "Fransızca", ja: "Japonca", ru: "Rusça", zh: "Çince",
};

const SEARCH_TERM_OVERRIDES: Record<string, string[]> = {
  ar: ["arapca", "arabic"], de: ["almanca", "german"], fa: ["farsca", "persian"],
  ja: ["japonca", "japanese"], ru: ["rusca", "russian"], tl: ["filipino", "tagalog"],
  zh: ["cince", "chinese", "中文"],
};

// Country flags are visual representatives only. They are deliberately explicit
// metadata, not inferred from the language code at render time.
const FLAG_COUNTRY_BY_LANGUAGE: Record<string, string> = {
  aa: "et", ab: "ge", ae: "ir", af: "za", ak: "gh", am: "et", an: "es", ar: "sa", as: "in", av: "ru", ay: "bo", az: "az",
  ba: "ru", be: "by", bg: "bg", bh: "in", bi: "vu", bm: "ml", bn: "bd", bo: "cn", br: "fr", bs: "ba",
  ca: "es", ce: "ru", ch: "gu", co: "fr", cr: "ca", cs: "cz", cu: "ru", cv: "ru", cy: "gb",
  da: "dk", de: "de", dv: "mv", dz: "bt", ee: "gh", el: "gr", en: "gb", es: "es", et: "ee", eu: "es",
  fa: "ir", ff: "sn", fi: "fi", fj: "fj", fo: "fo", fr: "fr", fy: "nl",
  ga: "ie", gd: "gb", gl: "es", gn: "py", gu: "in", gv: "im",
  ha: "ng", hi: "in", ho: "pg", hr: "hr", ht: "ht", hu: "hu", hy: "am", hz: "na",
  id: "id", ig: "ng", ii: "cn", ik: "us", is: "is", it: "it", iu: "ca",
  ja: "jp", jv: "id", ka: "ge", kg: "cd", ki: "ke", kj: "na", kk: "kz", kl: "gl", km: "kh", kn: "in", ko: "kr", kr: "ng", ks: "in", kv: "ru", kw: "gb", ky: "kg",
  la: "va", lb: "lu", lg: "ug", li: "nl", ln: "cd", lo: "la", lt: "lt", lu: "cd", lv: "lv",
  mg: "mg", mh: "mh", mi: "nz", mk: "mk", ml: "in", mn: "mn", mr: "in", ms: "my", mt: "mt", my: "mm",
  na: "nr", nb: "no", nd: "zw", ne: "np", ng: "na", nl: "nl", nn: "no", no: "no", nr: "za", nv: "us", ny: "mw",
  oc: "fr", oj: "ca", om: "et", or: "in", os: "ge", pa: "in", pi: "in", pl: "pl", ps: "af", pt: "pt",
  qu: "pe", rm: "ch", rn: "bi", ro: "ro", ru: "ru", rw: "rw",
  sa: "in", sc: "it", sd: "pk", se: "no", sg: "cf", si: "lk", sk: "sk", sl: "si", sm: "ws", sn: "zw", so: "so", sq: "al", sr: "rs", ss: "za", st: "za", su: "id", sv: "se", sw: "tz",
  ta: "in", te: "in", tg: "tj", th: "th", ti: "et", tk: "tm", tl: "ph", tn: "za", to: "to", tr: "tr", ts: "za", tt: "ru", tw: "gh", ty: "pf",
  ug: "cn", uk: "ua", ur: "pk", uz: "uz", ve: "za", vi: "vn", wa: "be", wo: "sn", xh: "za", yi: "ua", yo: "ng", za: "cn", zu: "za",
};

function getDisplayName(locale: string, language: string, fallback: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? fallback;
  } catch {
    return fallback;
  }
}

function countryCodeToEmoji(countryCode: string | null) {
  if (!countryCode || !/^[a-z]{2}$/.test(countryCode)) return "🌐";
  return String.fromCodePoint(
    ...countryCode.toUpperCase().split("").map((character) => 127397 + character.charCodeAt(0)),
  );
}

function createLanguage(code: string): MenuLanguageDefinition {
  const locale = LOCALE_OVERRIDES[code] ?? code;
  const nativeName = NATIVE_NAME_OVERRIDES[code] ?? getDisplayName(locale, code, code);
  const turkishName = TURKISH_NAME_OVERRIDES[code] ?? getDisplayName("tr-TR", code, nativeName);
  const englishName = getDisplayName("en-US", code, nativeName);
  const countryCode = FLAG_COUNTRY_BY_LANGUAGE[code] ?? null;

  return {
    code,
    baseCode: code,
    locale,
    nativeName,
    turkishName,
    englishName,
    direction: RTL_LANGUAGE_CODES.has(code) ? "rtl" : "ltr",
    flag: { emoji: countryCodeToEmoji(countryCode), countryCode },
    searchTerms: [code, locale, nativeName, turkishName, englishName, ...(SEARCH_TERM_OVERRIDES[code] ?? [])],
    popular: POPULAR_LANGUAGE_CODES.includes(code),
  };
}

const baseLanguages = ISO_639_1_CODES.filter((code) => code !== "zh").map(createLanguage);
const chineseVariants: MenuLanguageDefinition[] = [
  {
    ...createLanguage("zh"), code: "zh-CN", locale: "zh-CN", nativeName: "简体中文",
    turkishName: "Basitleştirilmiş Çince", englishName: "Simplified Chinese",
    flag: { emoji: "🇨🇳", countryCode: "cn" },
    searchTerms: ["zh", "zh-CN", "中文", "简体中文", "Çince", "cince", "Chinese", "Simplified"],
  },
  {
    ...createLanguage("zh"), code: "zh-TW", locale: "zh-TW", nativeName: "繁體中文",
    turkishName: "Geleneksel Çince", englishName: "Traditional Chinese",
    flag: { emoji: "🇹🇼", countryCode: "tw" },
    searchTerms: ["zh", "zh-TW", "中文", "繁體中文", "Çince", "cince", "Chinese", "Traditional"],
  },
];

const turkishCollator = new Intl.Collator("tr-TR", { sensitivity: "base" });

export const MENU_LANGUAGE_REGISTRY: readonly MenuLanguageDefinition[] = [
  ...baseLanguages,
  ...chineseVariants,
].sort((a, b) => turkishCollator.compare(a.turkishName, b.turkishName));

export const MENU_LANGUAGES = MENU_LANGUAGE_REGISTRY.filter((language) =>
  SUPPORTED_MENU_LOCALE_SET.has(language.code),
);
export const TOTAL_MENU_LANGUAGE_COUNT = MENU_LANGUAGES.length;
export const TOTAL_REGISTERED_MENU_LANGUAGE_COUNT = MENU_LANGUAGE_REGISTRY.length;
export const POPULAR_MENU_LANGUAGES = POPULAR_LANGUAGE_CODES
  .map((code) => MENU_LANGUAGES.find((language) => language.code === code))
  .filter((language): language is MenuLanguageDefinition => Boolean(language));

const registeredLanguageByCode = new Map(MENU_LANGUAGE_REGISTRY.map((language) => [language.code.toLocaleLowerCase("en-US"), language]));
const languageByCode = new Map(MENU_LANGUAGES.map((language) => [language.code.toLocaleLowerCase("en-US"), language]));

export function getMenuLanguage(code: string | null | undefined) {
  if (!code) return undefined;
  return languageByCode.get(code.toLocaleLowerCase("en-US"));
}

export function getRegisteredMenuLanguage(code: string | null | undefined) {
  if (!code) return undefined;
  return registeredLanguageByCode.get(code.toLocaleLowerCase("en-US"));
}

export function isMenuLanguage(code: string | null | undefined): code is MenuLanguage {
  return Boolean(getMenuLanguage(code));
}

export function matchBrowserLanguage(browserLocales: readonly string[]) {
  for (const browserLocale of browserLocales) {
    const normalized = browserLocale.replace("_", "-");
    const exact = getMenuLanguage(normalized);
    if (exact) return exact.code;
    const baseCode = normalized.split("-")[0]?.toLocaleLowerCase("en-US");
    if (baseCode === "zh") {
      return /(?:TW|HK|MO|Hant)/i.test(normalized) ? "zh-TW" : "zh-CN";
    }
    const base = getMenuLanguage(baseCode);
    if (base) return base.code;
  }
  return DEFAULT_MENU_LANGUAGE;
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[ıİ]/g, "i")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function searchMenuLanguages(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return MENU_LANGUAGES;
  const rank = (language: MenuLanguageDefinition) => {
    const identifiers = [language.code, language.locale].map(normalizeSearchText);
    const terms = language.searchTerms.map(normalizeSearchText);
    if (identifiers.includes(normalizedQuery)) return 0;
    if (terms.includes(normalizedQuery)) return 1;
    if (terms.some((term) => term.startsWith(normalizedQuery))) return 2;
    return 3;
  };
  return MENU_LANGUAGES.filter((language) =>
    language.searchTerms.some((term) => normalizeSearchText(term).includes(normalizedQuery)),
  ).sort((a, b) => rank(a) - rank(b) || turkishCollator.compare(a.turkishName, b.turkishName));
}
