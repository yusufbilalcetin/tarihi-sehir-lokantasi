import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";

import postgres from "postgres";

/**
 * The migration rehearsal: what only a real PostgreSQL can answer.
 *
 * Every other suite in this repository reasons about the schema from source.
 * These tests ask the database itself — do the constraints actually reject what
 * they claim to reject, does a tenant boundary hold when the application layer
 * is bypassed entirely, does Turkish survive a round trip. A CHECK constraint
 * that was never executed is a comment.
 *
 * It runs ONLY against a database named explicitly by `REHEARSAL_DATABASE_URL`,
 * and refuses any target that is not loopback or that carries the marks of a
 * Supabase project. Production must never be reachable from here, so the guard
 * is a precondition rather than a convention: with the variable unset the whole
 * suite skips, which is what happens on any ordinary test run.
 */

const rehearsalUrl = process.env.REHEARSAL_DATABASE_URL?.trim();

function disposableTarget(url: string | undefined): { url: string } | { skip: string } {
  if (!url) return { skip: "REHEARSAL_DATABASE_URL is not set" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { skip: "REHEARSAL_DATABASE_URL is not a URL" };
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    return { skip: `refusing a non-loopback target (${parsed.hostname})` };
  }
  return { url };
}

const target = disposableTarget(rehearsalUrl);
const skipReason = "skip" in target ? target.skip : false;

/**
 * Removes the rehearsal restaurants and everything hanging off them.
 *
 * The order is the point. `categories.restaurant_id` references `restaurants`
 * under RESTRICT, not CASCADE — a tenant carrying a menu cannot simply be
 * deleted, which is the right behaviour for real data and means teardown has to
 * walk the tree itself. Translations and cash counts *do* cascade from their
 * own parents, so they need no line here.
 */
async function clearRehearsalFixtures(sql: ReturnType<typeof postgres>): Promise<void> {
  const ids = await sql<{ id: string }[]>`
    select id from restaurants where slug in ('rehearsal-a', 'rehearsal-b')
  `;
  if (ids.length === 0) return;
  const restaurantIds = ids.map((row) => row.id);
  await sql`delete from cashier_shifts where restaurant_id in ${sql(restaurantIds)}`;
  await sql`delete from cash_registers where restaurant_id in ${sql(restaurantIds)}`;
  await sql`delete from products where restaurant_id in ${sql(restaurantIds)}`;
  await sql`delete from categories where restaurant_id in ${sql(restaurantIds)}`;
  await sql`delete from staff_profiles where restaurant_id in ${sql(restaurantIds)}`;
  await sql`delete from restaurants where id in ${sql(restaurantIds)}`;
}

describe("migration rehearsal on a disposable PostgreSQL", { skip: skipReason }, () => {
  let sql: ReturnType<typeof postgres>;
  let restaurantA: string;
  let restaurantB: string;
  let categoryA: string;
  let productA: string;

  before(async () => {
    sql = postgres((target as { url: string }).url, { max: 1, prepare: false });

    // A second belt on top of the URL check: a Supabase project carries roles
    // this cluster has no reason to have beyond the rehearsal shim.
    const [{ is_supabase }] = await sql<{ is_supabase: boolean }[]>`
      select exists (select 1 from pg_extension where extname = 'supabase_vault') as is_supabase
    `;
    assert.equal(is_supabase, false, "refusing to run against a Supabase project");

    restaurantA = randomUUID();
    restaurantB = randomUUID();
    categoryA = randomUUID();
    productA = randomUUID();

    // Re-runnable from any state. A previous run interrupted before teardown
    // must not make every later run fail on a unique slug — an integration
    // suite you can only run once is not a suite.
    await clearRehearsalFixtures(sql);

    for (const [id, slug] of [[restaurantA, "rehearsal-a"], [restaurantB, "rehearsal-b"]]) {
      await sql`
        insert into restaurants (id, name, slug, currency, timezone, default_locale, is_active)
        values (${id}, ${`Rehearsal ${slug}`}, ${slug}, 'TRY', 'Europe/Istanbul', 'tr', true)
      `;
    }
    await sql`
      insert into categories (id, restaurant_id, name, slug, sort_order, is_active)
      values (${categoryA}, ${restaurantA}, 'Çorbalar', 'corbalar', 1, true)
    `;
    await sql`
      insert into products (id, restaurant_id, category_id, name, slug, price, is_active, is_available)
      values (${productA}, ${restaurantA}, ${categoryA}, 'Mercimek Çorbası', 'mercimek', 120.00, true, true)
    `;
  });

  // Each test starts from the same clean slate, so one failure cannot cascade
  // into a run of misleading unique-key errors in every test after it.
  beforeEach(async () => {
    if (!sql) return;
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
    await sql`delete from category_translations where restaurant_id = ${restaurantA}`;
  });

  after(async () => {
    if (!sql) return;
    await clearRehearsalFixtures(sql);
    await sql.end({ timeout: 5 });
  });

  test("the tenant boundary is held by the database, not only by the service", async () => {
    // The composite foreign key is the point: a translation row naming
    // restaurant B and a category belonging to restaurant A matches no parent,
    // so the write fails even though both ids exist and both are well formed.
    // Application authorisation is the first line, never the only one.
    await assert.rejects(
      sql`
        insert into category_translations (restaurant_id, category_id, locale, name)
        values (${restaurantB}, ${categoryA}, 'en', 'Stolen Soups')
      `,
      (error: unknown) => (error as { code?: string }).code === "23503",
      "a cross-tenant category translation must violate the composite foreign key",
    );

    await assert.rejects(
      sql`
        insert into product_translations (restaurant_id, product_id, locale, name)
        values (${restaurantB}, ${productA}, 'en', 'Stolen Soup')
      `,
      (error: unknown) => (error as { code?: string }).code === "23503",
    );
  });

  test("one locale per entity, enforced by the database", async () => {
    await sql`
      insert into product_translations (restaurant_id, product_id, locale, name)
      values (${restaurantA}, ${productA}, 'en', 'Lentil Soup')
    `;
    await assert.rejects(
      sql`
        insert into product_translations (restaurant_id, product_id, locale, name)
        values (${restaurantA}, ${productA}, 'en', 'Second English Name')
      `,
      (error: unknown) => (error as { code?: string }).code === "23505",
      "a duplicate locale must violate the unique key",
    );

    // The upsert the repository actually issues is duplicate-safe against it.
    await sql`
      insert into product_translations (restaurant_id, product_id, locale, name)
      values (${restaurantA}, ${productA}, 'en', 'Traditional Lentil Soup')
      on conflict (restaurant_id, product_id, locale)
      do update set name = excluded.name, updated_at = now()
    `;
    const rows = await sql<{ name: string }[]>`
      select name from product_translations
      where restaurant_id = ${restaurantA} and product_id = ${productA} and locale = 'en'
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.name, "Traditional Lentil Soup");
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });

  test("a blank name and a malformed locale are both refused", async () => {
    await assert.rejects(
      sql`
        insert into product_translations (restaurant_id, product_id, locale, name)
        values (${restaurantA}, ${productA}, 'en', '   ')
      `,
      (error: unknown) => (error as { code?: string }).code === "23514",
      "whitespace is not a name",
    );
    // Two different walls stop a bad locale, and either is a correct answer:
    // the format CHECK (23514), and varchar(16) for anything long (22001).
    for (const locale of ["bitcoin-is-not-a-language", "e", "../en", "en_US", "EN-us-extra-long"]) {
      await assert.rejects(
        sql`
          insert into product_translations (restaurant_id, product_id, locale, name)
          values (${restaurantA}, ${productA}, ${locale}, 'Soup')
        `,
        (error: unknown) => ["23514", "22001"].includes((error as { code?: string }).code ?? ""),
        `${locale} must be refused by the database`,
      );
    }

    // And the five the menu actually ships are all accepted, including the
    // regional Chinese tags that must not be shortened to fit.
    for (const locale of ["tr", "en", "ar", "zh-CN", "zh-TW"]) {
      await sql`
        insert into product_translations (restaurant_id, product_id, locale, name)
        values (${restaurantA}, ${productA}, ${locale}, ${`Soup ${locale}`})
      `;
    }
    const [{ accepted }] = await sql<{ accepted: string }[]>`
      select count(*)::text as accepted from product_translations where restaurant_id = ${restaurantA}
    `;
    assert.equal(accepted, "5");
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });

  test("Chinese stays two languages all the way down to the unique index", async () => {
    await sql`
      insert into product_translations (restaurant_id, product_id, locale, name)
      values (${restaurantA}, ${productA}, 'zh-CN', '扁豆汤'),
             (${restaurantA}, ${productA}, 'zh-TW', '扁豆湯')
    `;
    const rows = await sql<{ locale: string; name: string }[]>`
      select locale, name from product_translations
      where restaurant_id = ${restaurantA} and locale like 'zh%' order by locale
    `;
    assert.deepEqual(rows.map((row) => row.locale), ["zh-CN", "zh-TW"]);
    // Two rows, and the simplified and traditional forms are genuinely
    // different text — a collapse would show up here as one row or as equality.
    assert.notEqual(rows[0]!.name, rows[1]!.name);
    assert.equal(rows[0]!.name, "扁豆汤");
    assert.equal(rows[1]!.name, "扁豆湯");
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });

  test("every script the menu ships in survives a round trip byte for byte", async () => {
    const samples: Readonly<Record<string, string>> = {
      tr: "İstanbul’un ışığı: Mercimek Çorbası, ğ ş ç ö ü ı İ",
      ar: "شوربة العدس",
      "zh-CN": "扁豆汤",
      "zh-TW": "扁豆湯",
      de: "Linsensuppe mit Weißbrot",
      ja: "レンズ豆のスープ 🍲",
      el: "Σούπα φακής",
      ru: "Чечевичный суп",
    };

    for (const [locale, name] of Object.entries(samples)) {
      await sql`
        insert into product_translations (restaurant_id, product_id, locale, name, description)
        values (${restaurantA}, ${productA}, ${locale}, ${name}, ${`${name} — açıklama`})
      `;
    }
    const rows = await sql<{ locale: string; name: string; description: string }[]>`
      select locale, name, description from product_translations
      where restaurant_id = ${restaurantA} order by locale
    `;
    assert.equal(rows.length, Object.keys(samples).length);
    for (const row of rows) {
      const expected = samples[row.locale]!;
      assert.equal(row.name, expected, `${row.locale} name changed in transit`);
      assert.equal(row.description, `${expected} — açıklama`);
      // Length in code points, not bytes: a mojibake round trip nearly always
      // changes this even when the string still looks plausible.
      assert.equal([...row.name].length, [...expected].length, `${row.locale} length changed`);
    }
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });

  test("deleting a category takes its translations with it and leaves nothing orphaned", async () => {
    const throwaway = randomUUID();
    await sql`
      insert into categories (id, restaurant_id, name, slug, sort_order, is_active)
      values (${throwaway}, ${restaurantA}, 'Tatlılar', 'tatlilar-rehearsal', 2, true)
    `;
    await sql`
      insert into category_translations (restaurant_id, category_id, locale, name)
      values (${restaurantA}, ${throwaway}, 'en', 'Desserts')
    `;
    await sql`delete from categories where id = ${throwaway}`;
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from category_translations where category_id = ${throwaway}
    `;
    assert.equal(count, "0", "ON DELETE CASCADE must clear the translations");
  });

  test("the cash drawer's arithmetic is enforced by the database", async () => {
    const registerId = randomUUID();
    const staffId = randomUUID();
    const shiftId = randomUUID();
    await sql`
      insert into cash_registers (id, restaurant_id, name, code, is_active)
      values (${registerId}, ${restaurantA}, 'Kasa 1', 'KASA1', true)
    `;
    await sql`
      insert into staff_profiles (id, restaurant_id, name, role, is_active)
      values (${staffId}, ${restaurantA}, 'Rehearsal Kasiyer', 'CASHIER', true)
    `;
    await sql`
      insert into cashier_shifts
        (id, restaurant_id, cash_register_id, register_name_snapshot, opened_by_staff_id, opened_at, status, opening_cash)
      values (${shiftId}, ${restaurantA}, ${registerId}, 'Kasa 1', ${staffId}, now(), 'OPEN', 1000.00)
    `;

    const count = (values: {
      phase?: string;
      currency?: string;
      denomination?: number;
      pieces?: number;
      subtotal?: number;
      restaurant?: string;
    }) => sql`
      insert into cashier_shift_cash_counts
        (restaurant_id, shift_id, phase, currency, denomination_minor, piece_count, subtotal_minor, counted_by_staff_id)
      values (
        ${values.restaurant ?? restaurantA}, ${shiftId}, ${values.phase ?? "OPENING"},
        ${values.currency ?? "TRY"}, ${values.denomination ?? 20000}, ${values.pieces ?? 5},
        ${values.subtotal ?? 100000}, ${staffId}
      )
    `;

    // The three currencies the restaurant actually takes.
    await count({ currency: "TRY", denomination: 20000, pieces: 5, subtotal: 100000 });
    await count({ currency: "EUR", denomination: 5000, pieces: 2, subtotal: 10000 });
    await count({ currency: "USD", denomination: 10000, pieces: 3, subtotal: 30000 });

    const rejects = (work: Promise<unknown>, code: string, why: string) =>
      assert.rejects(work, (error: unknown) => (error as { code?: string }).code === code, why);

    await rejects(count({ currency: "GBP" }), "23514", "an unsupported currency");
    await rejects(count({ pieces: -1, subtotal: -20000 }), "23514", "a negative piece count");
    await rejects(count({ pieces: 0, subtotal: 0 }), "23514", "a zero piece count");
    await rejects(count({ denomination: 0, subtotal: 0 }), "23514", "a zero denomination");
    // The forged total: a client claiming five 200₺ notes are worth 900₺.
    await rejects(count({ subtotal: 90000 }), "23514", "a subtotal that is not denomination × pieces");
    await rejects(
      count({ currency: "TRY", denomination: 20000, pieces: 5, subtotal: 100000 }),
      "23505",
      "the same denomination counted twice in one phase",
    );
    await rejects(count({ phase: "MIDDAY" }), "22P02", "a phase outside the enum");
    // A denomination nothing else used, so the composite tenant foreign key is
    // what refuses this row rather than the unique key getting there first.
    await rejects(
      count({ restaurant: restaurantB, denomination: 500, pieces: 1, subtotal: 500 }),
      "23503",
      "a count filed under another tenant",
    );

    // The three legitimate rows are all that survived.
    const [{ total }] = await sql<{ total: string }[]>`
      select count(*)::text as total from cashier_shift_cash_counts where shift_id = ${shiftId}
    `;
    assert.equal(total, "3");

    // Closing a shift must not silently drop the counted drawer.
    await sql`delete from cashier_shifts where id = ${shiftId}`;
    const [{ after_shift }] = await sql<{ after_shift: string }[]>`
      select count(*)::text as after_shift from cashier_shift_cash_counts where shift_id = ${shiftId}
    `;
    assert.equal(after_shift, "0", "counts cascade with their shift");
    await sql`delete from staff_profiles where id = ${staffId}`;
    await sql`delete from cash_registers where id = ${registerId}`;
  });

  test("the translation lookup index is the one the customer menu would use", async () => {
    await sql`
      insert into product_translations (restaurant_id, product_id, locale, name)
      values (${restaurantA}, ${productA}, 'en', 'Lentil Soup')
    `;
    // Not a benchmark, and deliberately not a claim about what the planner
    // does in production. On a table holding one row a sequential scan is the
    // correct choice and proves nothing either way. What is worth checking is
    // that the declared index can actually serve the shape of read the guest
    // menu performs on every language switch — so sequential scans are taken
    // away and the planner is asked what it would reach for instead.
    await sql`set enable_seqscan = off`;
    const forced = await sql<{ "QUERY PLAN": string }[]>`
      explain (costs off)
      select name from product_translations
      where restaurant_id = ${restaurantA} and locale = 'en'
    `;
    await sql`set enable_seqscan = on`;

    const indexPlan = forced.map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(
      indexPlan,
      /product_translations_restaurant_locale_idx/,
      `the declared lookup index must be able to serve this read; got:\n${indexPlan}`,
    );
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });

  test("timestamps come back as the instants they went in as", async () => {
    await sql`
      insert into product_translations (restaurant_id, product_id, locale, name)
      values (${restaurantA}, ${productA}, 'en', 'Lentil Soup')
    `;
    const [row] = await sql<{ created_at: Date; updated_at: Date; kind: string }[]>`
      select t.created_at, t.updated_at,
             (select data_type from information_schema.columns
               where table_name = 'product_translations' and column_name = 'created_at') as kind
      from product_translations t where t.restaurant_id = ${restaurantA}
    `;
    assert.equal(row!.kind, "timestamp with time zone", "instants, not wall-clock readings");
    assert.ok(row!.created_at instanceof Date);
    assert.ok(Math.abs(Date.now() - row!.created_at.getTime()) < 60_000, "clock is sane");
    await sql`delete from product_translations where restaurant_id = ${restaurantA}`;
  });
});
