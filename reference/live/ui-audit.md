# UI Audit — Tarihi Şehir Lokantası (canlı sürüm)

Kaynak: `https://tarihi-sehir-lokantasi.vercel.app` · Çekim: 2026-08-16
Tüm değerler canlı sayfadan `getComputedStyle` ile okunmuştur, tahmin yok.

---

## 1. Renk paleti

`:root` üzerindeki tokenlar (tek tema — dark varyantı tanımlı ama boş):

| Token | Değer | Kullanım |
|---|---|---|
| `--background` | `#f5ebdd` | Sayfa zemini, sıcak krem |
| `--foreground` | `#25211d` | Ana metin, koyu kahve-siyah |
| `--card` | `#fffdf8` | Kart yüzeyi, neredeyse beyaz krem |
| `--popover` | `#fffdf8` | Modal yüzeyi |
| `--primary` | `#681f25` | Bordo — birincil buton, fiyat, aktif sekme |
| `--primary-foreground` | `#fffdf8` | Bordo üstü metin |
| `--secondary` | `#30382d` | Koyu zeytin yeşili — mutfak/kasa başlığı, ana sayfa zemini |
| `--muted` | `#eee2d3` | Pasif yüzey |
| `--muted-foreground` | `#746b61` | İkincil metin |
| `--accent` | `#ead6c2` | Vurgulu yüzey (porsiyon/alerjen kutuları) |
| `--accent-foreground` | `#4a2828` | Accent üstü metin |
| `--destructive` | `#a13737` | Silme / iptal |
| `--border` | `#e5d6c4` | Hairline kenarlıklar |
| `--input` | `#dccbb7` | Form kenarlığı |
| `--ring` | `#b98352` | Bakır — focus halkası |
| `--chart-1..5` | `#681f25`, `#b98352`, `#30382d`, `#8c704a`, `#746b61` | Grafik serileri |
| `--sidebar` | `#2b3228` | Admin sidebar zemini |
| `--sidebar-primary` | `#b98352` | Sidebar aktif öğe |
| `--sidebar-accent` | `#3b4537` | Sidebar hover |
| `--sidebar-border` | `#46503f` | Sidebar ayraç |

Token dışı, ekranlarda ölçülen ek renkler:
- Menü hero kartı zemini: `#17130f` (neredeyse siyah kahve)
- Wordmark altını: `#c9a227` civarı gradyan (görsel içinde, CSS değil)
- Durum renkleri (masa/çağrı sol kenar kodu): yeşil = boş, sarı = sipariş bekliyor, mavi = serviste, pembe/kırmızı = garson çağrısı, mor = hesap istiyor, turkuaz = temizleniyor

**Karakter:** Tek bir sıcak, toprak tonlu palet. Saf beyaz ve saf siyah yok — her nötr krem/kahve tarafına kaydırılmış. Bordo tek "yüksek sesli" renk ve sadece aksiyon/fiyat için ayrılmış.

---

## 2. Tipografi

İki aile, `next/font` ile self-host (woff2, `assets/fonts/`):

| Rol | Aile | Örnek ölçüm |
|---|---|---|
| Başlık / display | **Lora** (serif) | `h1` 30px / 600 / lh 36px |
| Gövde / UI | **Manrope** (sans) | `body` 16px / 400 / lh 24px |
| Hero alt slogan | Lora | 14px / 400 / **letter-spacing 2.24px**, %65 opaklık |
| Arama inputu | Manrope | 14px |

Kurallar:
- Her sayfa başlığı ve kart başlığı serif (Lora). Sayısal veri, etiket, buton, form: sans (Manrope).
- Küçük üst etiketler (`MASANIZ`, `TÜM DİLLER`, `OPERASYON`) büyük harf + geniş letter-spacing + muted renk.
- KPI rakamları büyük ve ağır (dashboard `18.420 ₺` ~30px), altında küçük muted karşılaştırma satırı.
- Lora'nın geniş letter-spacing'li kullanımı (hero slogan, `Eski Usul • Yeni Nesil Lezzetler`) markanın imzası — korunmalı.

---

## 3. Spacing mantığı

- Temel birim 4px; yerleşimde ağırlıklı olarak 8 / 12 / 16 / 20 / 24 / 32 kullanılıyor.
- Kart içi padding: menü hero `20px 24px 32px`; içerik kartları ~24px.
- Grid boşluğu: kategori grid ve masa kartlarında ~16-20px.
- İçerik maksimum genişliği ortalanmış (~1050-1250px); admin'de sidebar 216px sabit + kalan alan akışkan.
- Dikey ritim cömert: bölüm başlığı ile grid arası ~32px, ekran üstü boşluk ~40px+. Sıkışık bir yüzey yok.
- Alt navigasyon sabit (fixed) ve içerik altında güvenli boşluk bırakıyor.

---

## 4. Kart yapıları

Üç ayrı kart dili var:

1. **Görsel kartlar (kategori)** — üstte 16:10'a yakın kapak görseli, altta krem şerit; başlık serif, altında `N ürün` muted. Köşe yarıçapı ~12-16px, gölge yok denecek kadar hafif, kenarlık hairline.
2. **Yatay ürün kartları** — solda kare görsel, sağda rozet çipleri → serif başlık → 2 satır muted açıklama → altta fiyat (bordo, ağır) ve sağda **yuvarlak dolu bordo `+` butonu**. Tükenen ürün: kart komple düşük opaklık, `+` pasif.
3. **Veri/panel kartları** — düz `#fffdf8` yüzey, hairline `#e5d6c4` kenarlık, gölgesiz. KPI kartlarında sağ üstte yuvarlak muted ikon rozeti. Vurgulanan tek KPI koyu zeytin zeminli (`--secondary`) — kontrast ile öne çıkarma.

Ortak: `--radius: .75rem` (12px) temel yarıçap. Menü hero kartı istisna — sadece alt köşeler **32px** ve büyük yumuşak gölge (`0 22px 60px rgba(37,33,29,.18)`), sayfanın tepesinden "sarkan" bir levha hissi veriyor.

Rozetler/çipler: pill (tam yuvarlak), ince kenarlık + çok açık dolgu, 11-12px metin. Durum rozetleri renk kodlu (yeşil/sarı/mavi/mor/pembe).

---

## 5. Buton stilleri

| Tip | Görünüm |
|---|---|
| Birincil | Dolu bordo `#681f25`, krem metin, ~12px yarıçap, tam genişlik (modal/sepet) veya kompakt (admin sağ üst). Gölgesiz. |
| İkincil / hayalet | Şeffaf ya da çok açık krem dolgu, hairline kenarlık, koyu metin (`Siparişi İptal Et`, `İndir`, `Yazdır`). |
| Yuvarlak aksiyon | Ürün kartındaki `+` — dolu bordo daire, ~40px. |
| Onay / pozitif | Koyu zeytin yeşili dolgu (`Servise teslim et`, `Tamamlandı`). |
| Ara durum | Bakır/tan dolgu (`Hazır olarak işaretle`). |
| Filtre çipi | Pill; seçili = dolu bordo + krem metin, seçili değil = açık krem + koyu metin. Yanında sayaç. |
| Toggle | Dolu bordo (açık) / muted (kapalı), tam yuvarlak. |

Focus: `--ring` (`#b98352`) bakır halka, `focus-visible` ile. Alt nav ve seçicilerde net görünüyor — erişilebilirlik açısından korunmalı.

Basma geri bildirimi çok ölçülü: `--press-scale: .995`, `--press-depth: 0px`. Yani buton "zıplamıyor", sadece hafifçe oturuyor.

---

## 6. Modal / popup davranışı

- Tümü **ortalanmış modal**, bottom sheet değil (masaüstü görünümünde). Ürün detayı da modal olarak açılıyor.
- Arka plan: karartma + `backdrop-filter` blur. (Tam ekran JPEG capture'da bu katman solgun çıkıyor — bileşenlerin net halleri `components/` altındaki PNG crop'larda.)
- Giriş animasyonu: `--modal-enter-scale: .985`, `--modal-enter-y: 4px`, süre `--motion-medium .22s`, easing `--ease-modal cubic-bezier(.22,.75,.25,1)`. Çıkış daha hızlı: `--motion-exit .15s`, `--modal-exit-y: 2px`.
- Yapı: (opsiyonel yuvarlak ikon rozeti) → serif başlık → muted açıklama → ayraç çizgisi → içerik → sabit alt aksiyon şeridi.
- Sağ üstte sade `×` butonu; `Escape` ile kapanıyor.
- Uzun modallarda (Dil Seç) başlık ve arama sabit, liste kendi içinde scroll.

---

## 7. Ikon dili

- **Lucide** ince çizgi (outline) ikon seti, ~1.5px stroke, tutarlı boyut (16/20/24px).
- İkonlar tek renk — muted ya da bordo; dolu/renkli ikon kullanılmıyor.
- Vurgu gereken yerde ikon, yuvarlak açık krem rozet içine alınıyor (KPI kartları, modal başlıkları, boş state'ler).
- Alt navigasyonda ikon + altında 11px etiket; aktif sekme bordo renk + altında kısa çizgi.
- Tek istisna: bayraklar (gerçek SVG bayrak seti) ve döviz modalındaki fotoğrafik madeni para/banknot görselleri — bunlar kasıtlı olarak ikon dilinin dışında.

---

## 8. Motion sistemi

`:root` üzerinde eksiksiz bir motion token seti var ve tutarlı kullanılıyor:

```
--motion-fast .14s   --motion-normal .18s   --motion-medium .22s   --motion-slow .28s
--motion-exit .15s   --motion-spatial .22s  --motion-press-in .1s  --motion-stagger 22ms
--ease-standard cubic-bezier(.25,.8,.25,1)
--ease-enter    cubic-bezier(.22,.75,.25,1)
--ease-exit     cubic-bezier(.4,0,.2,1)
--motion-ios-spring-soft / -snappy
```

Gözlenen davranışlar:
- Açılışta splash → hero fade/blur geçişi.
- Kategori kartlarında scroll ile "reveal once" (görünür olunca fade+yükselme, `--motion-stagger` ile sıralı).
- Sekme geçişlerinde içerik fade.
- Görsel yüklenirken düz renk placeholder → görsel geçişi.

Karakter: **hızlı, kısa mesafeli, gösterişsiz.** Çıkış her zaman girişten kısa. Bounce/overshoot yok.

---

## 9. Genel tasarım karakteri

Sıcak, toprak tonlu, "modern Anadolu lokantası" dili:

- Serif + sans ikilisi ile klasik/çağdaş dengesi; wordmark süslemesi (ferforje kıvrımlar) nostaljiyi taşıyor, geri kalan arayüz tamamen modern.
- Yüzeyler düz — gradyan, cam efekti, ağır gölge yok. Derinlik, kenarlık ve zemin tonu farkıyla kuruluyor.
- Fotoğraf odaklı: yemek görselleri geniş ve kaliteli, arayüz onların önüne geçmiyor.
- Müşteri yüzeyi (krem + koyu hero) ile operasyon yüzeyi (zeytin yeşili başlık/sidebar) bilinçli olarak ayrılmış; ikisi aynı paletten besleniyor.
- Bilgi yoğun panellerde bile aynı yumuşaklık korunmuş: pill rozetler, hairline ayraçlar, cömert satır yüksekliği.

**Yeniden yapımda korunması gerekenler:** palet tokenları, Lora/Manrope ikilisi ve geniş letter-spacing'li Lora kullanımı, 32px alt köşeli koyu hero levhası, yuvarlak bordo `+` butonu, durum renk kodları, motion token seti ve ölçülü press feedback'i, focus halkası.

**Kopyalanmaması gerekenler:** takılı kalan grafik animasyonu, dil listesindeki yerelleştirilmemiş kayıtlar, `/menu/invalid` davranışı, giriş sayfasındaki açık demo kimlik bilgileri, panellerin kimlik doğrulamasız erişilebilir olması, `public/` kökündeki kullanılmayan Next.js şablon SVG'leri.
