import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CASH_MOVEMENT_TYPE_LABELS,
  CUSTOMER_ORDER_ITEM_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  EMPTY_DISPLAY,
  ERROR_CODE_MESSAGES,
  ORDER_ITEM_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PRINT_ERROR_MESSAGES,
  STAFF_ROLE_LABELS,
  TABLE_STATUS_LABELS,
  WAITER_CALL_STATUS_LABELS,
  WAITER_CALL_TYPE_LABELS,
  activeLabel,
  displayLabel,
  errorCodeMessage,
  orderItemStatusLabel,
  orderStatusLabel,
  paymentMethodLabel,
  printErrorLabel,
  staffRoleLabel,
} from "../../lib/domain/display";
import { API_ERROR_CODES } from "../../lib/api/domain-error";
import { CASH_MOVEMENT_TYPES } from "../../lib/domain/cashier-shift";
import { PRINT_ERROR_CODES } from "../../lib/domain/print-routing";
import {
  ORDER_ITEM_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  TABLE_STATUSES,
  USER_ROLES,
  WAITER_CALL_STATUSES,
  WAITER_CALL_TYPES,
} from "../../lib/domain/status";

/**
 * Phase 32, section V: no stored value reaches a person unless somebody wrote
 * a sentence for it. The schema keeps its enums; this is the other half of the
 * contract, and it fails when a new enum member ships without its wording.
 */

const RAW_VALUE = /^[A-Z][A-Z0-9_]*$/;

function assertCovers(
  labels: Readonly<Record<string, string>>,
  values: readonly string[],
  name: string,
): void {
  for (const value of values) {
    const label = labels[value];
    assert.ok(label && label.length > 0, `${name} has no label for ${value}`);
    assert.doesNotMatch(
      label!,
      RAW_VALUE,
      `${name}[${value}] is still the raw value, not a sentence`,
    );
  }
}

test("every domain enum a person can see has a human label", () => {
  assertCovers(ORDER_STATUS_LABELS, ORDER_STATUSES, "ORDER_STATUS_LABELS");
  assertCovers(
    CUSTOMER_ORDER_STATUS_LABELS,
    ORDER_STATUSES,
    "CUSTOMER_ORDER_STATUS_LABELS",
  );
  assertCovers(ORDER_ITEM_STATUS_LABELS, ORDER_ITEM_STATUSES, "ORDER_ITEM_STATUS_LABELS");
  assertCovers(
    CUSTOMER_ORDER_ITEM_STATUS_LABELS,
    ORDER_ITEM_STATUSES,
    "CUSTOMER_ORDER_ITEM_STATUS_LABELS",
  );
  assertCovers(PAYMENT_METHOD_LABELS, PAYMENT_METHODS, "PAYMENT_METHOD_LABELS");
  assertCovers(PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, "PAYMENT_STATUS_LABELS");
  assertCovers(TABLE_STATUS_LABELS, TABLE_STATUSES, "TABLE_STATUS_LABELS");
  assertCovers(WAITER_CALL_TYPE_LABELS, WAITER_CALL_TYPES, "WAITER_CALL_TYPE_LABELS");
  assertCovers(WAITER_CALL_STATUS_LABELS, WAITER_CALL_STATUSES, "WAITER_CALL_STATUS_LABELS");
  assertCovers(CASH_MOVEMENT_TYPE_LABELS, CASH_MOVEMENT_TYPES, "CASH_MOVEMENT_TYPE_LABELS");
  assertCovers(STAFF_ROLE_LABELS, USER_ROLES, "STAFF_ROLE_LABELS");
  assertCovers(ERROR_CODE_MESSAGES, API_ERROR_CODES, "ERROR_CODE_MESSAGES");
  assertCovers(PRINT_ERROR_MESSAGES, PRINT_ERROR_CODES, "PRINT_ERROR_MESSAGES");
});

test("the same stored status reads differently for a guest and for the floor", () => {
  assert.equal(orderStatusLabel("PREPARING", "customer"), "Siparişiniz hazırlanıyor");
  assert.equal(orderStatusLabel("PREPARING", "staff"), "Hazırlanıyor");
  // A void is not a cancellation, and neither audience is told "VOIDED".
  assert.equal(orderItemStatusLabel("VOIDED", "customer"), "Hesaptan çıkarıldı");
  assert.equal(orderItemStatusLabel("VOIDED", "staff"), "Hesaptan düşüldü");
  assert.notEqual(orderItemStatusLabel("VOIDED"), orderItemStatusLabel("CANCELLED"));
});

test("an unmapped value degrades to a dash, never to the value itself", () => {
  const labels = { KNOWN: "Bilinen" };
  assert.equal(displayLabel(labels, "KNOWN"), "Bilinen");
  assert.equal(displayLabel(labels, "SOMETHING_NEW"), EMPTY_DISPLAY);
  assert.equal(displayLabel(labels, null), EMPTY_DISPLAY);
  assert.equal(displayLabel(labels, undefined), EMPTY_DISPLAY);
  assert.equal(displayLabel(labels, "SOMETHING_NEW", "Diğer"), "Diğer");

  assert.equal(orderStatusLabel("A_FUTURE_STATUS"), EMPTY_DISPLAY);
  assert.equal(staffRoleLabel("SOMMELIER"), EMPTY_DISPLAY);
  assert.equal(paymentMethodLabel("CRYPTO"), PAYMENT_METHOD_LABELS.OTHER);
  assert.equal(printErrorLabel("NEW_PRINTER_FAULT"), "Yazdırma hatası");
  assert.doesNotMatch(errorCodeMessage("SOME_NEW_CODE"), RAW_VALUE);
});

test("absent and boolean values are words, not null or true/false", () => {
  assert.equal(activeLabel(true), "Aktif");
  assert.equal(activeLabel(false), "Pasif");
  assert.equal(activeLabel(null), EMPTY_DISPLAY);
  assert.notEqual(EMPTY_DISPLAY, "N/A");
});

function sourceFiles(directory: string): string[] {
  const root = path.join(process.cwd(), directory);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) found.push(full);
    }
  };
  walk(root);
  return found;
}

test("no panel falls back to rendering the raw stored value", () => {
  // `LABELS[value] ?? value` reads as a safe default and is the exact shape
  // that puts PRINTER_WRITE_FAILED on somebody's screen the day an enum grows.
  const offenders: string[] = [];
  const rawFallback = /(\w*LABELS?)\[([\w.]+)\]\s*\?\?\s*\2\b/;
  for (const file of sourceFiles("components")) {
    const source = readFileSync(file, "utf8");
    if (rawFallback.test(source)) offenders.push(path.relative(process.cwd(), file));
  }
  assert.deepEqual(offenders, [], "these files fall back to the raw value");
});
