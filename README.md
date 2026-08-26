# Tarihi Şehir Lokantası

Modern QR menü ve restoran operasyonları için hazırlanmış, yalnızca frontend çalışan Next.js prototipi.

## Çalıştırma

```bash
npm install
npm run dev
```

Production doğrulaması:

```bash
npm run lint
npm run build
```

## Demo girişleri

- Müşteri menüsü: `http://localhost:3000/menu/demo-table`
- Garson girişi: `http://localhost:3000/staff/login`
- Personel kodu: `1042`
- PIN: `1234`
- Mutfak: `http://localhost:3000/kitchen`
- Kasa: `http://localhost:3000/cashier`
- Admin: `http://localhost:3000/admin/dashboard`

## Mimari

- `app/`: App Router route ve layout dosyaları
- `components/`: role göre ayrılmış reusable UI bileşenleri
- `components/ui/`: özelleştirilmiş shadcn/ui bileşenleri
- `lib/mock-data/`: gerçekçi demo verileri
- `lib/services/`: ileride backend adaptörü eklemek için servis sözleşmesi
- `types/`: ortak TypeScript modelleri
- `public/images/`: marka ve yemek görselleri

Firebase, veritabanı, gerçek authentication, ödeme API'si ve WebSocket kullanılmaz.

## Splash intro

QR menü introsu `components/menu/splash-intro.tsx` içindedir. Aşamalar `INTRO_TIMING`, toplam süre `INTRO_DURATION_MS` sabitinden değiştirilir. Aynı browser session'ında yalnızca bir kez gösterilir ve `prefers-reduced-motion` desteği vardır.

Şeffaf logo dosyası: `public/images/brand/wordmark-transparent.png`

QR menü keşif akışı: splash → kategori ana ekranı → kategori ürünleri → ürün detay sheet'i. Mobil geri eylemi detaydan ürün listesine, ürün listesinden kategori ekranına döner.

## Vercel Environment Variables

Firebase Web SDK için aşağıdaki değişkenleri Vercel proje ayarlarında tanımlayın:

- `NEXT_PUBLIC_FIREBASE_API_KEY` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_APP_ID` (zorunlu)
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` (isteğe bağlı; Analytics için)

Vercel'de her değişkeni **Production**, **Preview** ve **Development** ortamları için ekleyin. Değerleri repoya veya README'ye yazmayın; yerel geliştirmede git tarafından yok sayılan `.env.local` dosyasını, başlangıç şablonu olarak ise `.env.example` dosyasını kullanın.
