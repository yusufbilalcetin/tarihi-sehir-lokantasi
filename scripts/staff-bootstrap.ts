import { randomBytes } from "node:crypto";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Creates the first administrator of a restaurant, from a terminal only.
 *
 * There is deliberately no web route that grants anyone an admin role. A
 * restaurant with no administrator is bootstrapped by someone who already has
 * server access, and by nobody else. Once one active administrator exists, this
 * script refuses to make another unless it is told to in as many words.
 *
 *   npm run staff:bootstrap -- --restaurant <slug|uuid> --name "Ad Soyad" --email ad@ornek.com
 *
 * No password is accepted as an argument: shell history is not a place for
 * credentials. The account is created without a password and its holder sets
 * one through the printed setup link.
 */

const USAGE = `
Kullanım:
  npm run staff:bootstrap -- --restaurant <slug|uuid> --name "Ad Soyad" --email ad@ornek.com [seçenekler]

Seçenekler:
  --role <ADMIN|MANAGER|...>   Varsayılan ADMIN.
  --allow-additional-admin     Restoranda zaten aktif yönetici varsa bile oluştur.
  --temp-password              Kurulum bağlantısı yerine tek kullanımlık geçici şifre üret.
  --dry-run                    Hiçbir şey yazma; ne yapılacağını göster.

Not: şifre komut satırından ALINMAZ. Kurulum bağlantısı yalnız bir kez, bu terminalde gösterilir.
`.trim();

interface Options {
  restaurant: string;
  name: string;
  email: string;
  role: string;
  allowAdditionalAdmin: boolean;
  tempPassword: boolean;
  dryRun: boolean;
}

function parseArguments(argv: readonly string[]): Options | { error: string } {
  const options: Options = {
    restaurant: "",
    name: "",
    email: "",
    role: "ADMIN",
    allowAdditionalAdmin: false,
    tempPassword: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--restaurant":
      case "--name":
      case "--email":
      case "--role": {
        if (!value || value.startsWith("--")) return { error: `${flag} bir değer bekliyor.` };
        options[flag.slice(2) as "restaurant" | "name" | "email" | "role"] = value;
        index += 1;
        break;
      }
      case "--allow-additional-admin":
        options.allowAdditionalAdmin = true;
        break;
      case "--temp-password":
        options.tempPassword = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        return { error: "" };
      // A password on the command line ends up in shell history and in the
      // process list. Refused loudly rather than silently ignored.
      case "--password":
      case "--pass":
        return {
          error: "Şifre komut satırından verilemez. Kurulum bağlantısını veya --temp-password kullanın.",
        };
      default:
        return { error: `Bilinmeyen seçenek: ${flag}` };
    }
  }
  if (!options.restaurant) return { error: "--restaurant gereklidir." };
  if (!options.name.trim()) return { error: "--name gereklidir." };
  if (!options.email.trim()) return { error: "--email gereklidir." };
  return options;
}

async function main(): Promise<number> {
  const parsed = parseArguments(process.argv.slice(2));
  if ("error" in parsed) {
    if (parsed.error === "") {
      console.log(`\n${USAGE}\n`);
      return 0;
    }
    console.error(`\n${parsed.error}\n\n${USAGE}\n`);
    return 1;
  }

  // Imported lazily so `--help` and argument errors never need credentials.
  const [
    { getDb },
    schema,
    drizzle,
    domain,
    { getSupabaseAdminClient },
    { buildPasswordSetupLink },
  ] = await Promise.all([
    import("../db"),
    import("../db/schema"),
    import("drizzle-orm"),
    import("../lib/domain/staff-accounts"),
    import("../lib/supabase/admin"),
    import("../lib/auth/password-setup-link"),
  ]);
  const { and, eq, isNull, or } = drizzle;
  const { restaurants, staffProfiles, auditLogs } = schema;
  const { normalizeStaffEmail, isUserRole, STAFF_ROLE_LABELS } = domain;

  const email = normalizeStaffEmail(parsed.email);
  if (!email) {
    console.error("\nGeçersiz e-posta adresi.\n");
    return 1;
  }
  if (!isUserRole(parsed.role)) {
    console.error(`\nGeçersiz rol: ${parsed.role}\n`);
    return 1;
  }
  const role = parsed.role;

  const db = getDb();
  // Only compare against the id column when the argument actually looks like a
  // UUID: PostgreSQL raises on `uuid = 'a-slug'` rather than returning no rows.
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.restaurant);
  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(
      looksLikeUuid
        ? or(eq(restaurants.slug, parsed.restaurant), eq(restaurants.id, parsed.restaurant))!
        : eq(restaurants.slug, parsed.restaurant),
    )
    .limit(1);
  if (!restaurant) {
    console.error(`\nRestoran bulunamadı: ${parsed.restaurant}\n`);
    return 1;
  }

  const existingAdmins = await db
    .select({ id: staffProfiles.id, name: staffProfiles.name, email: staffProfiles.email })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.restaurantId, restaurant.id),
        eq(staffProfiles.role, "ADMIN"),
        eq(staffProfiles.isActive, true),
        isNull(staffProfiles.deletedAt),
      ),
    );

  // The guard that makes this safe to leave in the repository: bootstrap is for
  // a restaurant that has nobody, not a back door into one that has somebody.
  if (role === "ADMIN" && existingAdmins.length > 0 && !parsed.allowAdditionalAdmin) {
    console.error(
      `\n${restaurant.name} zaten ${existingAdmins.length} aktif yöneticiye sahip:\n` +
        existingAdmins.map((admin) => `  - ${admin.name} <${admin.email ?? "?"}>`).join("\n") +
        "\n\nYeni yönetici gerçekten gerekiyorsa --allow-additional-admin ile tekrar çalıştırın.\n",
    );
    return 1;
  }

  console.log(
    `\nRestoran : ${restaurant.name} (${restaurant.slug})\n` +
      `Ad Soyad : ${parsed.name.trim()}\n` +
      `E-posta  : ${email}\n` +
      `Rol      : ${STAFF_ROLE_LABELS[role]} (${role})\n`,
  );
  if (parsed.dryRun) {
    console.log("--dry-run: hiçbir kayıt oluşturulmadı.\n");
    return 0;
  }

  const supabase = getSupabaseAdminClient();
  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    ...(parsed.tempPassword ? { password: randomBytes(24).toString("base64url") } : {}),
  });
  if (created.error || !created.data.user) {
    console.error(`\nGiriş hesabı oluşturulamadı: ${created.error?.message ?? "bilinmeyen hata"}\n`);
    return 1;
  }
  const authUserId = created.data.user.id;

  try {
    await db.transaction(async (transaction) => {
      const [profile] = await transaction
        .insert(staffProfiles)
        .values({
          restaurantId: restaurant.id,
          authUserId,
          name: parsed.name.trim(),
          email,
          role,
          isActive: true,
        })
        .returning({ id: staffProfiles.id });
      if (!profile) throw new Error("Personel kaydı oluşturulamadı.");

      await transaction.insert(auditLogs).values({
        restaurantId: restaurant.id,
        // Nobody was signed in: the actor is the operator at the terminal.
        actorUserId: null,
        action: "staff.created",
        entityType: "STAFF_PROFILE",
        entityId: profile.id,
        newValue: { name: parsed.name.trim(), role, email, source: "bootstrap-cli" },
      });
    });
  } catch (error) {
    const removal = await supabase.auth.admin.deleteUser(authUserId);
    console.error(
      `\nPersonel kaydı oluşturulamadı: ${(error as Error).message}\n` +
        (removal.error
          ? `UYARI: artık kullanılmayan giriş hesabı silinemedi (${authUserId}). Elle silin.\n`
          : "Oluşturulan giriş hesabı geri alındı.\n"),
    );
    return 1;
  }

  console.log("Hesap oluşturuldu.\n");

  if (parsed.tempPassword) {
    // Deliberately not printed: the password was generated only so that the
    // account is not passwordless, and it is discarded here unread. The holder
    // sets their own through the link below.
    console.log("Geçici şifre üretildi ve hiçbir yere yazılmadı.\n");
  }

  const link = await supabase.auth.admin.generateLink({ type: "recovery", email });
  // See scripts/staff-setup-link.ts: this application's own page redeems the
  // hashed token, so the provider's action_link is deliberately unused.
  if (link.error || !link.data.properties?.hashed_token) {
    console.log(
      "Şifre kurulum bağlantısı üretilemedi. Yönetim panelinden\n" +
        '"Şifre Sıfırlama Bağlantısı Gönder" ile tekrar deneyin.\n',
    );
    return 0;
  }

  console.log(
    "Şifre kurulum bağlantısı (TEK KULLANIMLIK, yalnız bir kez gösterilir):\n\n" +
      `  ${buildPasswordSetupLink(link.data.properties.hashed_token)}\n\n` +
      "Bu bağlantıyı ilgili kişiye güvenli bir kanaldan iletin. Hiçbir yere kaydedilmedi.\n",
  );
  return 0;
}

main()
  .then(async (code) => {
    await import("../db").then(({ closeDb }) => closeDb()).catch(() => undefined);
    process.exit(code);
  })
  .catch((error) => {
    // Never print a provider payload: it can carry a token.
    console.error(`\nBeklenmeyen hata: ${error instanceof Error ? error.name : "bilinmiyor"}\n`);
    process.exit(1);
  });
