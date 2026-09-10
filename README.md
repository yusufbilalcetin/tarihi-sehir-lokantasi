# Tarihi Şehir Lokantası

Tek bir lokanta için QR menü ve restoran operasyon sistemi. Müşteri masadaki QR
kodu okutup sipariş verir; garson, mutfak, kasa ve yönetim panelleri aynı
veritabanı üzerinden çalışır.

## Gereksinimler

- Node.js 20+
- PostgreSQL (Supabase projesi önerilir)
- Yazıcı kullanılacaksa ESC/POS uyumlu bir yazıcı ve `tools/printer-agent`

## Kurulum

```bash
npm install
cp .env.example .env.local   # değerleri doldurun
npm run db:migrate
npm run dev
```

## Ortam değişkenleri

Tüm değişkenler ve ne işe yaradıkları `.env.example` içinde açıklanmıştır.
Gerçek değerleri yalnızca `.env.local` veya deployment secret ayarlarında
tutun; repoya yazmayın.

`NEXT_PUBLIC_` önekli olanlar dışındaki her değer server-only'dir. Özellikle
`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, `QR_TOKEN_PEPPER`,
`STAFF_SESSION_SECRET`, `OUTBOX_DISPATCH_SECRET`, `MAINTENANCE_SECRET` ve
`PRINTER_AGENT_TOKEN_PEPPER` hiçbir koşulda browser'a gönderilmemelidir.

## Veritabanı

Şema kaynağı `db/schema.ts`, sürümlenen migration'lar `db/migrations/`
altındadır. Ayrıntılar için `docs/database.md`.

```bash
npm run db:generate   # şema değişikliğinden migration üret
npm run db:migrate    # bekleyen migration'ları uygula
npm run db:studio     # Drizzle Studio
npm run db:seed       # geliştirme verisi (ALLOW_DATABASE_SEED=true gerekir)
```

Seed verisi `db/seed-data/` altındadır ve yalnızca geliştirme içindir.

## Roller ve panel erişimi

Yetki matrisi `lib/auth/role-access.ts` içindeki tek kaynaktan yönetilir.

| Panel | Erişebilen roller |
| --- | --- |
| `/admin/*` | `ADMIN`, `MANAGER` |
| `/staff/*` | `ADMIN`, `MANAGER`, `WAITER` |
| `/kitchen` | `ADMIN`, `MANAGER`, `KITCHEN` |
| `/cashier` | `ADMIN`, `MANAGER`, `CASHIER` |

Personel hesapları Supabase Auth üzerinde tutulur. İlk hesabı oluşturmak için:

```bash
npm run staff:bootstrap -- --help
npm run staff:setup-link -- --help
```

Yetki kontrolü her zaman server tarafında yapılır: `proxy.ts` yalnızca kaba bir
kimlik doğrulaması yapar, rol ve restoran kapsamı layout'larda ve API
handler'larında yeniden doğrulanır.

## Müşteri akışı

QR kodundaki tek kullanımlık token `proxy.ts` içinde doğrulanır ve kısa ömürlü,
imzalı bir HttpOnly masa oturumu cookie'sine çevrilir. Ham token hiçbir zaman
istemciye veya log'a düşmez. Sipariş fiyatları istemciden gelen değerle değil,
her zaman veritabanındaki güncel fiyatla hesaplanır.

## Geliştirme ve doğrulama

```bash
npm run dev
npm run lint
npm run build
npm start                   # production derlemesini çalıştırır (önce npm run build)
npm run test:foundation     # saf birim testleri, veritabanı gerektirmez
npm run test:integration    # ayrı bir TEST veritabanı gerektirir, aşağıya bakın
```

### Panel ve sipariş akışı HTTP E2E'si

`tests/integration/phase9a-…` (panel yetkilendirmesi) ve `phase9b-…` (sipariş →
mutfak → kasa yaşam döngüsü) çalışan bir loopback sunucusuna karşı koşar; ikisi
de opt-in'dir ve kendi kayıtlarını temizler. Gerekli değişkenler her dosyanın
başındaki açıklamada listelidir; hesaplar `npm run staff:bootstrap` ile
oluşturulur ve şifreleri yalnızca kurulum bağlantısıyla belirlenir.

### Integration testleri ve test veritabanı

> **Integration test kimlik bilgileri production/uygulama Supabase projesini
> asla göstermemelidir.**

Bu testler sipariş, ödeme ve audit kaydı **yazar** ve bunları silmez. Bu yüzden
hedef ortam atılabilir olmalıdır:

| Ortam | Durum |
| --- | --- |
| Lokal disposable Supabase (`supabase start`, loopback) | Tercih edilen |
| Ayrı "… TEST" Supabase projesi (kendi project ref'i) | Kabul edilir |
| Production / uygulamanın kullandığı proje | **Yasak** |

Değişkenler `.env.integration.example` içinde açıklanmıştır; uygulamanın normal
Supabase değişkenlerine hiçbir zaman geri düşmez.

`tests/integration/supabase-test-environment.ts` son emniyet kapısıdır: hedef,
`NEXT_PUBLIC_SUPABASE_URL` ile aynı Supabase projesine veya `DATABASE_URL` ile
aynı veritabanı kimliğine çözümlenirse suite **çalışmaz**. Canlı değerleri
kopyalamak testleri başlatmaz, yalnızca bir ret mesajı üretir. Paylaşılan lokal
loopback stack bu kuraldan muaftır.

## Zamanlanmış işler (outbox dispatcher)

Realtime olayları önce `outbox_events` tablosuna yazılır ve panellere ancak bir
worker onları yayımladıktan sonra ulaşır. Uygulama içinde bu worker'ı çağıran
hiçbir yol yoktur: tek giriş noktası korumalı
`/api/internal/outbox/dispatch` ucudur. **Bu uç düzenli olarak çağrılmazsa
realtime hiç çalışmaz** ve outbox sınırsız büyür.

`vercel.json` bunu dakikada bir çalışan bir Vercel Cron işi olarak tanımlar.
Vercel cron yalnızca `GET` gönderir ve `Authorization: Bearer $CRON_SECRET`
başlığını ekler; bu yüzden route hem `GET` hem `POST` kabul eder ve deployment
ortamında **`CRON_SECRET`, `OUTBOX_DISPATCH_SECRET` ile aynı değere
ayarlanmalıdır**. Secret olmadan gelen çağrı 401 alır.

Kapasite sınırı bilinçlidir: her çağrı en çok `OUTBOX_BATCH_SIZE` olayı sırayla
yayımlar, yani dakikada bir cron ile üst sınır dakikada o kadar olaydır.
Paneller ayrıca 15–30 saniyede bir kendi verilerini yeniden okuduğu için
dispatcher gecikse bile ekranlar bayat kalmaz; realtime bu yolun üzerine
gecikme iyileştirmesidir, tek kaynağı değildir.

## Yazıcı ajanı

Lokal ESC/POS yazıcılarına basım `tools/printer-agent` üzerinden yapılır.
Kurulum ve token yönetimi için `tools/printer-agent/README.md` ve
`docs/printing.md`.

## Dokümantasyon

- `docs/database.md` — şema, migration ve bağlantı yönetimi
- `docs/database-recovery.md` — yedek ve kurtarma
- `docs/data-retention.md` — veri saklama ve temizlik
- `docs/printing.md` — basım mimarisi
- `docs/security-foundation.md` — kimlik, yetki ve sır yönetimi
- `docs/long-term-capacity.md` — kapasite planlaması
