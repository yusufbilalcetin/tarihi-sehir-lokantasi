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
 * A settings screen may show a control it cannot save, but it must never let
 * one look like a control it can.
 *
 * The form used to hold persisted fields, fields with a persisted column it
 * simply never sent, and purely local previews in one hand-written literal,
 * under one "Değişiklikleri Kaydet" button and one green success toast. Two
 * toggles sat on a hardcoded `true` while the restaurant's real value said
 * otherwise, and three interactive sections carried no warning at all.
 */

const result: RestaurantSettingsResult = {
  menuEnabled: true,
  orderingEnabled: false,
  waiterCallEnabled: false,
  billRequestEnabled: false,
  introEnabled: true,
  waiterApprovalRequired: false,
  customerNotesEnabled: false,
  menuImagesEnabled: false,
  serviceFeeRate: "10.00",
  taxRate: "0.00",
  maxItemQuantity: 20,
  orderNotesMaxLength: 500,
  waiterCallCooldownSeconds: 60,
  version: 3,
  profile: {
    name: "Tarihi Şehir Lokantası",
    phone: null,
    address: null,
    logoUrl: null,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    defaultLocale: "tr-TR",
  },
};

test("every persisted toggle is hydrated from the restaurant, not from a default", () => {
  const form = settingsFormFromResult(result);
  // All false on the server: a form that shows them on is telling the manager
  // the guest can do something the restaurant has switched off.
  assert.equal(form.orderingEnabled, false);
  assert.equal(form.waiterApprovalRequired, false);
  assert.equal(form.customerNotesEnabled, false);
  assert.equal(form.menuImagesEnabled, false);
  assert.equal(form.waiterCallEnabled, false);
  assert.equal(form.billRequestEnabled, false);
});

test("what the save button sends is exactly what the form claims to hold", () => {
  const patch = settingsPatchFromForm(settingsFormFromResult(result));
  // Every persisted column the screen shows — the restaurant's own details
  // included, which used to have real columns and no way to reach them.
  assert.deepEqual(
    Object.keys(patch).sort(),
    [
      "address",
      "billRequestEnabled",
      "currency",
      "customerNotesEnabled",
      "defaultLocale",
      "introEnabled",
      "maxItemQuantity",
      "menuEnabled",
      "menuImagesEnabled",
      "name",
      "orderNotesMaxLength",
      "orderingEnabled",
      "phone",
      "serviceFeeRate",
      "taxRate",
      "timezone",
      "waiterApprovalRequired",
      "waiterCallCooldownSeconds",
      "waiterCallEnabled",
    ],
    "a field in the form but not in the patch is a control that quietly does nothing",
  );
  // And the API accepts every one of them, so none is a field the server drops.
  assert.equal(updateSettingsBodySchema.safeParse(patch).success, true);
});

test("a round trip through the form changes nothing on its own", () => {
  const patch = settingsPatchFromForm(settingsFormFromResult(result));
  const expected: Record<string, unknown> = {
    ...result,
    ...result.profile,
    // Absent in the database reads as an empty box, and saves back as absent.
    phone: "",
    address: "",
  };
  for (const [key, value] of Object.entries(patch)) {
    assert.equal(value, expected[key], `${key} drifted`);
  }
});

test("every section that cannot be saved says so", () => {
  const source = readFileSync(
    new URL("../../components/admin/settings-manager.tsx", import.meta.url),
    "utf8",
  );
  // The warning is a property of the section, not a fragment to remember to
  // paste: forgetting it on three sections is what produced the false save.
  assert.match(source, /preview\?: boolean/);
  assert.match(source, /\{preview \? SETTINGS_PREVIEW_NOTE : null\}/);

  // Sections whose controls reach no column at all. "İşletme bilgileri" has
  // left this list: its fields now have an endpoint that writes them.
  for (const title of ["Çalışma saatleri", "Logo", "Menü bannerı"]) {
    const section = source.slice(source.indexOf(`title="${title}"`));
    assert.ok(
      section.slice(0, 400).includes("preview"),
      `"${title}" is interactive but never persisted, and says nothing`,
    );
  }
  assert.ok(SETTINGS_PREVIEW_ONLY.length >= 4);
});

test("the primary action names what it actually saves", () => {
  const source = readFileSync(
    new URL("../../components/admin/settings-manager.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /> Değişiklikleri Kaydet</,
    "a button over five tabs that saves two of them must not claim to save everything",
  );
  // It may claim the whole screen now, because it saves the whole of it.
  assert.match(source, /<Save \/> Ayarları Kaydet/);
});

test("a failed load cannot be saved over the restaurant's real settings", () => {
  const source = readFileSync(
    new URL("../../components/admin/settings-manager.tsx", import.meta.url),
    "utf8",
  );
  // `useApiResource` clears `loading` in a `finally`, so it goes false on a
  // failed GET too. Gating the save on it would arm the button over untouched
  // defaults — and this form's defaults switch QR ordering and both guest call
  // buttons off.
  assert.match(source, /disabled=\{saving \|\| !settings\}/);
  assert.doesNotMatch(source, /disabled=\{saving \|\| resource\.loading\}/);
  assert.match(source, /kayıtlı ayarlara dokunulmadı/, "the failure has to say nothing was changed");
});
