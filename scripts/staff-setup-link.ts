import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Prints a one-time password-setup link for an existing staff account.
 *
 * The panel asks the provider to *email* this link, which is the right default.
 * When the project has no custom SMTP — Supabase's built-in sender is rate
 * limited and meant for testing — that email does not arrive, and onboarding
 * would stall. This is the terminal-side fallback: the operator generates the
 * link and hands it over through a channel they trust.
 *
 *   npm run staff:setup-link -- --email personel@ornek.com
 *
 * The link is a credential in link form. It is printed once, never stored,
 * never logged and never audited, and it is deliberately not available in the
 * browser panel for the same reason.
 */

const USAGE = `
Kullanım:
  npm run staff:setup-link -- --email personel@ornek.com

Bu komut mevcut bir personel hesabı için tek kullanımlık şifre kurulum bağlantısı üretir.
Bağlantı yalnız burada gösterilir; hiçbir yere kaydedilmez. Güvenli bir kanalla iletin.
`.trim();

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const index = argv.indexOf("--email");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (argv.includes("--help") || argv.includes("-h") || !value) {
    console.log(`\n${USAGE}\n`);
    return value ? 0 : 1;
  }

  const [domain, { getSupabaseAdminClient }, { getDb }, schema, drizzle] = await Promise.all([
    import("../lib/domain/staff-accounts"),
    import("../lib/supabase/admin"),
    import("../db"),
    import("../db/schema"),
    import("drizzle-orm"),
  ]);
  const email = domain.normalizeStaffEmail(value);
  if (!email) {
    console.error("\nGeçersiz e-posta adresi.\n");
    return 1;
  }

  // Only for somebody who is actually staff here, and actually active: a link
  // for a deactivated account would hand back access the panel just removed.
  const { and, eq, isNull } = drizzle;
  const { staffProfiles } = schema;
  const [profile] = await getDb()
    .select({ name: staffProfiles.name, role: staffProfiles.role })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.email, email),
        eq(staffProfiles.isActive, true),
        isNull(staffProfiles.deletedAt),
      ),
    )
    .limit(1);
  if (!profile) {
    console.error(`\nBu adrese sahip aktif bir personel kaydı yok: ${email}\n`);
    return 1;
  }

  const link = await getSupabaseAdminClient().auth.admin.generateLink({
    type: "recovery",
    email,
  });
  // The hashed token, not the provider's action_link: the link must land on
  // this application's own set-password page, which redeems the token server
  // side and never puts a recovery session in the browser.
  if (link.error || !link.data.properties?.hashed_token) {
    console.error(`\nBağlantı üretilemedi: ${link.error?.message ?? "bilinmeyen hata"}\n`);
    return 1;
  }
  const { buildPasswordSetupLink } = await import("../lib/auth/password-setup-link");
  const setupLink = buildPasswordSetupLink(link.data.properties.hashed_token);

  console.log(
    `\n${profile.name} (${domain.STAFF_ROLE_LABELS[profile.role]})\n` +
      `${email}\n\n` +
      "Şifre kurulum bağlantısı (TEK KULLANIMLIK, yalnız bir kez gösterilir):\n\n" +
      `  ${setupLink}\n\n` +
      "Güvenli bir kanalla iletin. Hiçbir yere kaydedilmedi.\n",
  );
  return 0;
}

main()
  .then(async (code) => {
    // Close the pool before exiting, or Node tears the socket down mid-flight
    // and libuv complains on Windows.
    await import("../db").then(({ closeDb }) => closeDb()).catch(() => undefined);
    process.exit(code);
  })
  .catch((error) => {
    console.error(`\nBeklenmeyen hata: ${error instanceof Error ? error.name : "bilinmiyor"}\n`);
    process.exit(1);
  });
