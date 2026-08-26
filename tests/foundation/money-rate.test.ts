import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBasisPoints,
  minorUnits,
  percentageToBasisPoints,
} from "../../lib/domain/money";

test("percentage rates stay exact and round half-up in minor units", () => {
  assert.equal(percentageToBasisPoints("12.50"), 1_250);
  assert.equal(applyBasisPoints(minorUnits(999), 1_250), 125);
  assert.equal(applyBasisPoints(minorUnits(1), 5_000), 1);
});

test("percentage helpers reject out-of-range and imprecise rates", () => {
  assert.throws(() => percentageToBasisPoints("100.01"));
  assert.throws(() => percentageToBasisPoints("1.001"));
  assert.throws(() => applyBasisPoints(minorUnits(100), -1));
});
