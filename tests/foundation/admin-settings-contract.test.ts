import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SETTINGS_PREVIEW_ONLY,
  settingsFormFromResult,
  settingsPatchFromForm,
} from "../../components/admin/settings-manager";
import { updateSettingsBodySchema } from "../../lib/validation/admin-settings";
import type { RestaurantSettingsResult } from "../../lib/services/admin-settings-service";

/**
 * The settings screen's promise: everything it shows as saved, is saved.
 *
 * The restaurant's own profile — its name, telephone, address, currency,
 * timezone and language — has had real columns on `restaurants` all along and
 * no endpoint that could write them, so the screen showed a hardcoded name and
 * a form that went nowhere. These tests hold the whole chain to one contract:
 * GET → form → PATCH → validation → back.
 */

const schema = readFileSync(new URL("../../db/schema.ts", import.meta.url), "utf8");
const manager = readFileSync(
  new URL("../../components/admin/settings-manager.tsx", import.meta.url),
  "utf8",
);

const result: RestaurantSettingsResult = {
  menuEnabled: false,
  orderingEnabled: false,
  waiterCallEnabled: false,
  billRequestEnabled: false,
  introEnabled: false,
  waiterApprovalRequired: false,
  customerNotesEnabled: false,
  menuImagesEnabled: false,
  serviceFeeRate: "10.00",
  taxRate: "8.50",
  maxItemQuantity: 12,
  orderNotesMaxLength: 250,
  waiterCallCooldownSeconds: 45,
  version: 7,
  profile: {
    name: "Tarihi Şehir Lokantası",
    phone: "0224 224 18 42",
    address: "Kayhan Mah. Ünlü Cad. No: 18, Osmangazi / Bursa",
    logoUrl: null,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    defaultLocale: "tr-TR",
  },
};

// ------------------------------------------------ 1, 2, 12: the profile

test("the restaurant's own details survive the round trip", () => {
  const form = settingsFormFromResult(result);
  assert.equal(form.name, "Tarihi Şehir Lokantası");
  assert.equal(form.phone, "0224 224 18 42");
  assert.equal(form.address, "Kayhan Mah. Ünlü Cad. No: 18, Osmangazi / Bursa");
  assert.equal(form.currency, "TRY");
  assert.equal(form.timezone, "Europe/Istanbul");
  assert.equal(form.defaultLocale, "tr-TR");

  const patch = settingsPatchFromForm(form);
  for (const key of ["name", "phone", "address", "currency", "timezone", "defaultLocale"] as const) {
    assert.equal(patch[key], result.profile[key], `${key} did not survive the save`);
  }
  assert.equal(updateSettingsBodySchema.safeParse(patch).success, true);
});

// ------------------------------------------------------- 3: honest hydration

test("a switched-off setting hydrates as off, never as a default", () => {
  const form = settingsFormFromResult(result);
  for (const key of [
    "menuEnabled",
    "orderingEnabled",
    "waiterCallEnabled",
    "billRequestEnabled",
    "introEnabled",
    "waiterApprovalRequired",
    "customerNotesEnabled",
    "menuImagesEnabled",
  ] as const) {
    assert.equal(form[key], false, `${key} came back on while the restaurant has it off`);
  }
});

// ------------------------------------------------------- 4, 5: money rates

test("the service charge and the tax rate round trip exactly", () => {
  const form = settingsFormFromResult(result);
  assert.equal(form.serviceFeeRate, "10.00");
  assert.equal(form.taxRate, "8.50");
  const patch = settingsPatchFromForm(form);
  assert.equal(patch.serviceFeeRate, "10.00");
  assert.equal(patch.taxRate, "8.50");

  // They are percentages, not fractions: the column is numeric(5,2) checked
  // `between 0 and 100`, so 10.00 means ten per cent.
  assert.match(schema, /restaurant_settings_service_fee_rate_check[\s\S]{0,120}between 0 and 100/);
  assert.match(schema, /restaurant_settings_tax_rate_check[\s\S]{0,120}between 0 and 100/);
  for (const bad of ["-1.00", "101.00", "10.005"]) {
    assert.equal(
      updateSettingsBodySchema.safeParse({ taxRate: bad }).success,
      false,
      `${bad} was accepted as a rate`,
    );
  }
  assert.equal(updateSettingsBodySchema.safeParse({ taxRate: "0.00" }).success, true);
  assert.equal(updateSettingsBodySchema.safeParse({ taxRate: "100.00" }).success, true);
});

// ------------------------------------- 6: one contract for the call cooldown

test("the waiter-call wait accepts exactly what the database accepts", () => {
  // The column is checked `between 5 and 3600`. The API used to start at 0, so
  // 0-4 passed validation and then failed as a constraint violation — a 500
  // where the operator should have been told the value was out of range.
  const bounds = /restaurant_settings_call_cooldown_check[\s\S]{0,160}between (\d+) and (\d+)/.exec(
    schema,
  );
  assert.ok(bounds, "the database constraint moved");
  const [, low, high] = bounds;
  assert.equal(low, "5");
  assert.equal(high, "3600");

  for (const value of [Number(low), Number(high), 30]) {
    assert.equal(
      updateSettingsBodySchema.safeParse({ waiterCallCooldownSeconds: value }).success,
      true,
      `${value} is valid in the database but refused by the API`,
    );
  }
  for (const value of [0, 4, Number(high) + 1, -1]) {
    assert.equal(
      updateSettingsBodySchema.safeParse({ waiterCallCooldownSeconds: value }).success,
      false,
      `${value} would reach the database and violate its constraint`,
    );
  }
});

test("the other numeric limits also match their constraints", () => {
  assert.match(schema, /restaurant_settings_max_item_quantity_check[\s\S]{0,120}between 1 and 99/);
  assert.match(schema, /restaurant_settings_notes_length_check[\s\S]{0,120}between 0 and 1000/);
  assert.equal(updateSettingsBodySchema.safeParse({ maxItemQuantity: 0 }).success, false);
  assert.equal(updateSettingsBodySchema.safeParse({ maxItemQuantity: 100 }).success, false);
  assert.equal(updateSettingsBodySchema.safeParse({ orderNotesMaxLength: 1001 }).success, false);
  assert.equal(updateSettingsBodySchema.safeParse({ orderNotesMaxLength: 0 }).success, true);
});

// -------------------------------------------- 8: previews stay off the wire

test("nothing the screen only previews is ever sent to the server", () => {
  const patch = settingsPatchFromForm(settingsFormFromResult(result));
  for (const invented of ["slogan", "instagram", "weekday", "weekend", "logoName", "bannerName", "accent", "priceStyle"]) {
    assert.ok(!(invented in patch), `${invented} has no column and must not be saved`);
  }
  // And the schema would refuse them even if one leaked.
  assert.equal(
    updateSettingsBodySchema.safeParse({ ...patch, slogan: "x" }).success,
    false,
    "the API accepts a field the database has nowhere to put",
  );
  assert.ok(SETTINGS_PREVIEW_ONLY.length > 0);
});

test("what the form holds is exactly what the save sends", () => {
  const patch = settingsPatchFromForm(settingsFormFromResult(result));
  const form = settingsFormFromResult(result);
  assert.deepEqual(
    Object.keys(patch).sort(),
    Object.keys(form).sort(),
    "a field in the form but not in the patch is a control that quietly does nothing",
  );
});

// ------------------------------------------------- 13: rates are snapshotted

test("changing the rates cannot move an order that already exists", () => {
  const orderService = readFileSync(
    new URL("../../lib/services/order-service.ts", import.meta.url),
    "utf8",
  );
  // The rates are copied onto the order when it is created, and every later
  // recalculation reads the order's own copy — so a rate change tomorrow leaves
  // yesterday's bills exactly as they were.
  assert.match(orderService, /serviceFeeRate: context\.serviceFeeRate/);
  assert.match(orderService, /taxRate: context\.taxRate/);
  assert.match(orderService, /order\.serviceFeeRate \?\? "0\.00"/);
  assert.match(orderService, /order\.taxRate \?\? "0\.00"/);
  assert.match(schema, /serviceFeeRate: percentage\("service_fee_rate"\)/);
});

// --------------------------------------- 14, 15: the screen's own language

test("the restaurant's name comes from the restaurant, not from a literal", () => {
  const editor = readFileSync(
    new URL("../../components/admin/customer-menu-editor.tsx", import.meta.url),
    "utf8",
  );
  for (const [file, source] of [
    ["settings-manager", manager],
    ["customer-menu-editor", editor],
  ] as const) {
    assert.doesNotMatch(
      source,
      /const restaurantName = "Tarihi Şehir Lokantası"|name: "Tarihi Şehir Lokantası"/,
      `${file} still hardcodes the restaurant's name`,
    );
  }
});

test("the screen speaks to a restaurateur, not to an engineer", () => {
  // Field names are a contract with the server, not words for an operator.
  for (const jargon of [">serviceFeeRate<", ">taxRate<", ">cooldown<", ">locale<", ">payload<"]) {
    assert.ok(!manager.includes(jargon), `${jargon} is shown to the user`);
  }
  for (const word of ["Servis Ücreti", "Vergi Oranı", "Saat Dilimi", "Para Birimi"]) {
    assert.ok(manager.includes(word), `the screen never says "${word}"`);
  }
  // Percentages are shown as percentages.
  assert.match(manager, /%/);
});

// ----------------------------------------------------- 7: load / save safety

test("a failed load still cannot be saved over the restaurant's settings", () => {
  assert.match(manager, /disabled=\{saving \|\| !settings\}/);
  assert.doesNotMatch(manager, /disabled=\{saving \|\| resource\.loading\}/);
  assert.match(manager, /kayıtlı ayarlara dokunulmadı/);
});

test("a concurrent edit is refused rather than silently overwritten", () => {
  // `restaurant_settings` carries a version and the service already guards the
  // write with it; the screen sends back the version it loaded so the second
  // administrator is told, instead of quietly winning.
  assert.match(manager, /expectedVersion/);
  assert.equal(
    updateSettingsBodySchema.safeParse({ taxRate: "1.00", expectedVersion: 3 }).success,
    true,
  );
  assert.equal(
    updateSettingsBodySchema.safeParse({ taxRate: "1.00", expectedVersion: 0 }).success,
    false,
  );
});
