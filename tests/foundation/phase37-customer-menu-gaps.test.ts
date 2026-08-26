import assert from "node:assert/strict";
import test from "node:test";

import {
  customerCallStatusTranslationKey,
  matchesCustomerMenuSearch,
  normalizeCustomerMenuSearch,
} from "../../lib/domain/customer-menu";

test("customer menu search is Turkish-case and diacritic insensitive", () => {
  for (const query of ["mercimek", "Mercimek", "MERCİMEK"]) {
    assert.equal(matchesCustomerMenuSearch(query, ["Mercimek Çorbası"], "tr-TR"), true);
  }
  for (const query of ["çorba", "Çorba", "CORBA"]) {
    assert.equal(matchesCustomerMenuSearch(query, ["Mercimek Çorbası"], "tr-TR"), true);
  }
  assert.equal(matchesCustomerMenuSearch("kofte", ["Izgara Köfte"], "tr-TR"), true);
  assert.equal(matchesCustomerMenuSearch("köfte", ["Izgara Kofte"], "tr-TR"), true);
  assert.equal(normalizeCustomerMenuSearch("Iİıi ŞĞÜÖÇ", "tr-TR"), "iiii sguoc");
});

test("customer search only matches the explicitly supplied visible fields", () => {
  assert.equal(
    matchesCustomerMenuSearch("çorba", ["Mercimek Çorbası", "Tereyağlı ev çorbası", "Çorbalar"]),
    true,
  );
  assert.equal(
    matchesCustomerMenuSearch("internal-product-uuid", ["Mercimek Çorbası", "Tereyağlı", "Çorbalar"]),
    false,
  );
});

test("customer call states map to translated copy keys without raw enums", () => {
  assert.equal(customerCallStatusTranslationKey("WAITER_CALL", "OPEN"), "waiterRequestSent");
  assert.equal(customerCallStatusTranslationKey("BILL_REQUEST", "OPEN"), "billSent");
  assert.equal(customerCallStatusTranslationKey("WAITER_CALL", "ACKNOWLEDGED"), "waiterConfirmed");
  assert.equal(customerCallStatusTranslationKey("BILL_REQUEST", "ACKNOWLEDGED"), "waiterConfirmed");
});
