# Veritabanı çalışma rehberi

Bu proje PostgreSQL/Supabase üzerinde Drizzle ORM kullanır. Şema kaynağı
`db/schema.ts`, sürümlenen migration'lar `db/migrations/` altındadır. Uygulama
build'i veritabanına bağlanmaz; bağlantı ilk `getDb()` çağrısında açılır.

## Gereken yerel ortam değişkenleri

Gerçek değerleri yalnız `.env.local` veya deployment secret ayarlarında tutun:

```dotenv
DATABASE_URL=postgresql://...
QR_TOKEN_PEPPER=...
```

- `DATABASE_URL`, server-only Supabase PostgreSQL bağlantısıdır. Vercel gibi
  serverless ortamlarda Supabase transaction pooler URL'si önerilir.
- `QR_TOKEN_PEPPER` en az 32 byte entropili server-only bir değerdir. QR token
  hashleri bu pepper olmadan doğrulanamaz; rotasyonu ayrıca planlanmalıdır.
- Browser'a gönderilecek hiçbir değişkene bu değerleri koymayın ve
  `NEXT_PUBLIC_` öneki kullanmayın.

## Şema ve migration

Yeni additive değişiklikten sonra migration üretin:

```bash
npm run db:generate
```

Bu komut canlı veritabanına bağlanmadan çalışabilir. Üretilen SQL ve snapshot'ı
review edin. `DROP TABLE`, `DROP COLUMN`, enum daraltma veya veri dönüştürme
görürseniz production'a uygulamadan önce yedekleme ve rollout planı hazırlayın.

Migration'ları ileri yönde uygulayın:

```bash
npm run db:migrate
```

İlk foundation migration'ı Supabase hedeflidir ve `auth.users`, `auth.uid()`,
`anon` ile `authenticated` rollerinin bulunmasını bekler. Ayrıca:

- `staff_profiles.auth_user_id -> auth.users.id` FK'sini kurar;
- RLS'yi tüm domain tablolarında açar;
- browser rollerinden tüm doğrudan mutation yetkilerini geri alır;
- authenticated staff'a yalnız kendi aktif restoranında sınırlı SELECT
  politikaları verir; QR hash içeren masa tablosu ve ödeme tablosu browser'a
  doğrudan açılmaz;
- seçili operasyon tablolarını mevcutsa `supabase_realtime` publication'ına
  ekler;
- merkezi `updated_at` trigger'larını ve atomik restoran counter fonksiyonunu
  oluşturur.

Supabase dashboard/SQL editor üzerinden migration sonrasında Auth FK, RLS
politikaları ve realtime publication üyeliklerini doğrulayın. Uygulama yazma
işlemleri server-side Drizzle servis rolü/bağlantısı üzerinden auth ve restaurant
scope kontrollerinden sonra yapılmalıdır.

## Development seed

Seed hiçbir zaman migration sırasında veya uygulama başlangıcında otomatik
çalışmaz. Yalnız development ortamında, açık onay flag'iyle çalışır:

```powershell
$env:NODE_ENV="development"
$env:ALLOW_DATABASE_SEED="true"
npm run db:seed
```

Seed mevcut mock menü, masa, personel, sipariş ve çağrı verilerini idempotent
upsert eder. Fiyat snapshot toplamlarını doğrular. Seed sırasında güvenli rastgele
QR tokenlar oluşturulur fakat ham tokenlar bilerek atılır ve asla loglanmaz;
seed masaları token açısından revoked başlar. Kullanılabilir QR üretmeden önce
admin token-rotation akışıyla her masa için yeni token oluşturup ham değeri bir
kez QR üreticisine teslim edin.

Flag'i seed sonrasında terminal oturumundan kaldırın:

```powershell
Remove-Item Env:ALLOW_DATABASE_SEED
```

## Drizzle Studio

`DATABASE_URL` tanımlıyken yalnız yetkili geliştirme ortamında açın:

```bash
npm run db:studio
```

Studio doğrudan database yetkileriyle çalışır ve uygulama RBAC'ını atlayabilir.
Production database üzerinde rutin içerik yönetimi için kullanmayın.

## Deployment bölgesi

`vercel.json` içindeki `"regions": ["fra1"]`, uygulamayı veritabanının bulunduğu
bölgede (Frankfurt / AWS `eu-central-1`, Supabase pooler host adındaki
`aws-0-eu-central-1` öneki) çalıştırmak içindir. Vercel'in varsayılanı `iad1`
(Washington D.C.) ve bu varsayılan, her SQL gidiş-dönüşüne kıtalararası gecikme
ekler.

Bunun neden ölçülebilir bir fark yarattığı: uygulamanın gecikmesi neredeyse
tamamen *gidiş-dönüş sayısı × RTT*'dir. Faz 32'de Türkiye'den Frankfurt'a ölçülen
RTT 47 ms iken sunucu tarafı sorgu yürütmesi 100 bin siparişte 3–72 ms'ydi. Aynı
bölgede RTT tipik olarak birkaç milisaniyedir.

`DATABASE_URL` bölgesi değişirse bu değer de birlikte değişmelidir; ikisinin
ayrışması, hiçbir sorgu yavaşlamadan tüm uygulamanın yavaşladığı sessiz bir
regresyondur. Bölge kodları: Frankfurt `fra1`, Paris `cdg1`, Londra `lhr1`,
Washington `iad1`. Hobby planı tek bölgeye izin verir; birden çok bölge Pro ve
üzeri gerektirir.

## Production güvenliği

- Production migration öncesinde backup/PITR durumunu doğrulayın.
- Migration'ı tek bir kontrollü release job'ından çalıştırın; her Vercel
  instance başlangıcında çalıştırmayın.
- Supabase pooler kapasitesiyle uyumlu connection limitleri kullanın.
- Secret veya ham QR token loglamayın.
- Bu repository kasıtlı olarak reset/drop komutu sağlamaz. Veri silen bir işlem
  gerekiyorsa ayrı, açıkça review edilmiş bir migration hazırlayın.
- Drizzle snapshot'larını elle şema kaynağı gibi düzenlemeyin; schema değişikliği
  sonrası CLI ile yeniden üretin. İlk migration'daki Drizzle dışı trigger/RLS/
  publication SQL'ini koruyun.

## Veri saklama, yedekleme ve kapasite

Hangi tablonun kalıcı olduğu, hangi teknik satırların zamanlanmış bir job
tarafından silinebildiği, yedekleme/restore prosedürü ve uzun vadeli büyüme
modeli ayrı belgelerdedir:

- `docs/data-retention.md` — 20 tablonun sınıflandırması, otomatik silme
  allow/deny listesi ve maintenance servisi.
- `docs/database-recovery.md` — backup doğrulama gereksinimi ve restore
  runbook'u.
- `docs/long-term-capacity.md` — ölçülmüş boyut baseline'ı ve 2/5/10 yıllık
  büyüme modeli.

Finansal ve operasyonel geçmiş (`orders`, `order_items`, `payments`,
`payment_refunds`, `order_checks`, `order_check_items`, `audit_logs`,
`order_events`) için DELETE tabanlı retention **yoktur**; master data soft
delete ile yönetilir.

## Tek veritabanında migration uygulama (0013–0016)

> Bu bölüm gelecekteki bir uygulama içindir. Phase 41 sonunda migration'lar
> **uygulanmamıştır** ve kullanıcı yetkisi beklenmektedir.

### Runner davranışı — önce bunu bilin

`npm run db:migrate` → `drizzle-orm/postgres-js` migrator. Kaynak
(`drizzle-orm/pg-core/dialect.cjs`) şu yapıdadır:

```js
await session.transaction(async (tx) => {
  for await (const migration of migrations) {  // <-- döngü transaction'ın İÇİNDE
    if (pending) { ...tüm statement'lar...; history satırı }
  }
});
```

Bunun üç doğrudan sonucu vardır:

1. **Bekleyen tüm migration'lar TEK bir transaction'da çalışır.** 0013, 0014,
   0015 ve 0016 birlikte commit olur veya birlikte geri alınır. Kısmi uygulama
   mümkün değildir.
2. **Aralarında duraklamak mümkün değildir.** "0013'ü çalıştır, doğrula, sonra
   0014" akışı bu runner ile desteklenmez. Doğrulama ancak dört migration
   commit olduktan sonra yapılabilir.
3. **Kilitler tüm batch boyunca tutulur.** 0015'in `orders` üzerindeki
   `ACCESS EXCLUSIVE` kilidi, 0016 commit edene kadar bırakılmaz. Aynı şekilde
   0013'ün `orders`, `products`, `restaurant_tables`, `restaurants`,
   `staff_profiles` üzerindeki `SHARE ROW EXCLUSIVE` kilitleri de sonuna kadar
   sürer. Mevcut satır sayılarında bu kısadır, ancak servis açıkken yapılmamalıdır.

Migration dosyaları transaction içinde çalıştığı için `CREATE INDEX
CONCURRENTLY` gibi ifadeler kullanılamaz (PostgreSQL 25001).
`tests/foundation/phase41-migration-readiness.test.ts` bunu engeller.

### Mantıksal yedek (pg_dump) — migration öncesi zorunlu adım

`pg_dump` istemcisi **sunucu sürümüne eşit veya daha yeni** olmalıdır. Sunucu
PostgreSQL 17.6 olduğundan PostgreSQL 17 istemci araçları gerekir.

Yedek dosyası **asla bir Git çalışma ağacının içine yazılmaz**.

> **Dikkat — bu makinede kullanıcı ana dizini bir Git deposudur.**
> `C:/Users/user` altında `.git` vardır ve `AppData` dahil hiçbir alt dizin yok
> sayılmamaktadır (`git check-ignore` → çıkış kodu 1). Bu nedenle ana dizin
> altındaki herhangi bir yedek klasörü izlenmeye aday olur. Yedekler kullanıcı
> ana dizininin **dışına** yazılmalıdır.
>
> Doğrulanmış güvenli hedef: `C:/Users/Public/sehir-lokantasi-backups`
> — hiçbir Git deposunun içinde değildir ve yükseltilmiş yetki gerektirmeden
> yazılabilir.

```bash
BACKUP_DIR="/c/Users/Public/sehir-lokantasi-backups"
mkdir -p "$BACKUP_DIR"

# Deterministik, UTC damgalı ad. Kimlik bilgisi, parola, müşteri adı içermez.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/eski-usul-lokantasi-pre-0013-0016-$STAMP.dump"

# -Fc : custom format (pg_restore ile seçici geri yükleme)
#
# --no-owner : nesne sahipliğini dışarıda bırakır. Supabase'de tablolar
#   postgres/supabase_admin gibi rollere aittir ve geri yüklerken bunları
#   ayarlamaya çalışmak hataya yol açar.
#
# --no-privileges KULLANILMIYOR — bilinçli tercih:
#   0013 ve 0014, güvenlik açısından belirleyici olan
#   `REVOKE ALL ON TABLE ... FROM anon, authenticated` ifadelerini içerir.
#   --no-privileges bu GRANT/REVOKE ifadelerini arşivden çıkarır; o arşivden
#   geri yüklenen tablolar varsayılan izinlerle gelir ve ERP tablolarının
#   tarayıcıya/Data API'ye kapalı olduğu garanti edilemez. Bu bayrağın var
#   olma nedeni (rol hataları) --no-owner ile zaten çözülür.
#
#   Yalnızca geri yüklemede gerçekten rol izni hatası alınırsa --no-privileges
#   eklenir ve bu durumda REVOKE'ler geri yükleme sonrası elle uygulanmalıdır.
pg_dump "$DATABASE_URL" -Fc --no-owner -f "$OUT"

# Arşiv yapısını doğrula (geri yükleme DEĞİL, sadece okunabilirlik)
pg_restore --list "$OUT" | head -40

# SHA-256 (Git Bash yoksa: certutil -hashfile "<yol>" SHA256)
sha256sum "$OUT" > "$OUT.sha256"

# Boyut ve varlık kontrolü
ls -l "$OUT"
```

`-Fc` çıktısı şema, veri, kısıtlar, indeksler, fonksiyon/trigger'lar ve
`drizzle.__drizzle_migrations` geçmişini içerir.

**`DATABASE_URL` veya parola hiçbir zaman ekrana yazdırılmaz, log'lanmaz veya
dosya adına konmaz.**

`pg_restore --list` çıktısının okunabilir olması arşivin **yapısal** olarak
sağlam olduğunu gösterir; **başarılı bir geri yükleme kanıtı değildir.** İkinci
bir veritabanı olmadığı için gerçek restore testi yapılamaz.


### Yazma dondurma (write freeze) planı — hazırlandı, ETKİNLEŞTİRİLMEDİ

Migration transaction'ı şu kilitleri alır ve **commit edene kadar bırakmaz**:

| Tablo | Kilit | Kaynak |
| --- | --- | --- |
| `orders` | `ACCESS EXCLUSIVE` | 0015 (`ALTER TABLE orders`) |
| `orders`, `products`, `restaurants`, `restaurant_tables`, `staff_profiles` | `SHARE ROW EXCLUSIVE` | 0013 (yeni tabloların FK'leri bu tabloları referanslar) |

`orders` üzerindeki `ACCESS EXCLUSIVE`, **okumaları da** bloklar. Yani migration
sırasında sipariş okuyan/yazan her istek uygulama tarafında beklemeye girer ve
zaman aşımına uğrar. Uygulama "kendiliğinden" duracaktır — ancak bu kontrollü
bir duruş değildir; istekler yığılır. Bu yüzden bakım penceresi zorunludur.

**Yazma kaynakları ve önerilen kaldıraçlar** (tamamı mevcut kontrollerle):

| Yazar | Kaldıraç | Not |
| --- | --- | --- |
| Misafir QR siparişi | `restaurants.is_active = false` | `lib/auth/customer-table-context.ts` bunu zaten kontrol eder; oturum açılışı temiz bir alan hatasıyla reddedilir |
| Gel-al / kurye siparişi | `restaurants.is_active = false` | `lib/auth/guest-order-context.ts` aynı kontrolü yapar |
| Sipariş takibi | `restaurants.is_active = false` | `lib/auth/order-tracking-context.ts` aynı kontrolü yapar |
| Garson / mutfak / kasa | Bakım penceresi (personel bilgilendirmesi) + oturum kapatma | Personel yolları restoran `is_active` bayrağına bağlı değildir; bu yüzden operasyonel talimat gerekir |
| Outbox cron | **Vercel → Cron Jobs → ilgili işi devre dışı bırak** | `vercel.json` bu işi `* * * * *` ile dakikada bir çalıştırır. Migration'ın kilitlediği tablolara dokunmaz, ancak pencere boyunca duraklatılmalıdır |
| Bakım işi (`/api/internal/maintenance`) | Zamanlayıcıyı duraklat | Ayrı bearer secret ile korunur; kendiliğinden çalışmaz |
| Yazıcı ajanı | Ajanları durdur (opsiyonel) | Yalnızca `print_jobs` yazar; migration'ın kilitlediği tablolara dokunmaz |

**Sıra önemlidir:** `restaurants.is_active = false` güncellemesi migration'dan
**önce** yapılmalıdır. Migration `restaurants` üzerinde `SHARE ROW EXCLUSIVE`
tuttuğu için, transaction başladıktan sonra bu güncelleme bloklanır.

`is_active` bir işletme bayrağıdır; pencere kapanınca `true` değerine geri
alınmalıdır. Bu adım kontrol listesinin parçasıdır.

> Bu plan **uygulanmamıştır**. Hiçbir bayrak değiştirilmemiş, hiçbir cron
> duraklatılmamıştır.

### Üretim uyarı gereksinimleri (sağlayıcı seçimi sonraya bırakıldı)

Yapısal sinyaller mevcuttur; **dışarıya uyarı iletimi yoktur**. Sağlayıcı
seçildiğinde en az şu kategoriler bir yere ulaşmalıdır:

| Kategori | Kaynak sinyal |
| --- | --- |
| API 5xx artışı | `mutation_failed` / `read_failed` (requestId ile) |
| Ödeme hatası | `api.payments` → `create_failed` |
| Outbox ölü mektup | `outbox_dead_lettered` |
| Yazıcı kalıcı hatası | `print_job_retries_exhausted` |
| Bakım/cron hatası | `dispatch_failed`, bakım rotası hataları |
| Veritabanı erişilebilirliği | `/api/health` dış kontrol |

### Migration öncesi kontrol listesi

0. PostgreSQL 17 istemci araçları kurulu ve `pg_dump --version` 17.x doğrulandı
1. Restoran bakım penceresi ilan edildi
2. Yeni yazma işlemleri durduruldu (`restaurants.is_active = false`, Vercel cron duraklatıldı)
3. Açık ödeme/sipariş mutasyonu olmadığı doğrulandı
4. 0015 uyumluluk sorgusu yeniden çalıştırıldı
5. Tüm siparişler DINE_IN değişmezini sağlıyor (`table_id is not null`)
6. `pg_dump` alındı
7. `pg_restore --list` ile arşiv yapısı doğrulandı
8. WAL arşivleyici sağlıklı (`pg_stat_archiver.failed_count = 0`)
9. Mevcut migration geçmişi kaydedildi
10. Mevcut satır sayıları kaydedildi
11. Mevcut şema parmak izi kaydedildi
12. Ancak bundan sonra `npm run db:migrate`
13. Migration sonrası doğrulama geçince `restaurants.is_active = true` geri alınır ve cron yeniden etkinleştirilir

### Migration sonrası doğrulama (salt-okunur)

```sql
-- 29 ERP tablosu + fulfillment_request_items
select count(*) from information_schema.tables
 where table_schema='public' and table_name in (...);

-- orders.channel var ve eski siparişlerin tamamı DINE_IN
select channel, count(*) from orders group by 1;
select count(*) from orders where table_id is null and channel='DINE_IN';   -- 0 olmalı

-- kısıt mevcut ve doğrulanmış
select conname, convalidated from pg_constraint
 where conrelid='public.orders'::regclass and conname='orders_channel_table_check';

-- 0016 indeksi
select indexname from pg_indexes
 where tablename='stock_movements' and indexname='stock_movements_restaurant_occurred_idx';

-- migration geçmişi 0016'ya kadar (17 satır)
select count(*) from drizzle.__drizzle_migrations;

-- doğrulanmamış kısıt kalmadı
select conname from pg_constraint where not convalidated;

-- satır kaybı yok: migration öncesi sayılarla karşılaştırın
```

### Migration sonrası HTTP smoke

Şema kaynaklı 500'ler kaybolmalıdır:

```
/api/admin/erp
/api/admin/erp/waste
/api/admin/erp/production
/api/admin/erp/suppliers
/api/admin/erp/fulfillment
/api/admin/reports/summary
/api/staff/orders
```
