import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReportUrlState,
  serializeReportUrlState,
} from "../../lib/domain/report-url-state";

const defaults = { today: "2026-08-14" };

test("a shared link reproduces the sender's screen", () => {
  const state = parseReportUrlState(
    "?range=CUSTOM&from=2026-07-01&to=2026-07-31&comparison=PREVIOUS_YEAR&tab=kitchen",
    defaults,
  );

  assert.deepEqual(state, {
    range: "CUSTOM",
    from: "2026-07-01",
    to: "2026-07-31",
    comparison: "PREVIOUS_YEAR",
    tab: "kitchen",
  });
});

test("an unknown or hand-edited value falls back instead of failing", () => {
  const state = parseReportUrlState(
    "?range=LAST_CENTURY&comparison=YESTERYEAR&tab=payroll&from=01/07/2026&to=",
    defaults,
  );

  assert.deepEqual(state, {
    range: "LAST_30_DAYS",
    from: defaults.today,
    to: defaults.today,
    comparison: "NONE",
    tab: "overview",
  });
});

test("an empty query is the default report", () => {
  assert.equal(parseReportUrlState("", defaults).range, "LAST_30_DAYS");
  assert.equal(parseReportUrlState("", defaults).tab, "overview");
});

test("the round trip is stable", () => {
  for (const search of [
    "?range=TODAY&comparison=PREVIOUS_PERIOD&tab=products",
    "?range=CUSTOM&from=2026-01-01&to=2026-03-31&comparison=NONE&tab=review",
  ]) {
    const state = parseReportUrlState(search, defaults);
    assert.deepEqual(
      parseReportUrlState(`?${serializeReportUrlState(state)}`, defaults),
      state,
    );
  }
});

test("only a custom range puts its dates in the link", () => {
  const link = serializeReportUrlState({
    range: "THIS_MONTH",
    from: "2026-01-01",
    to: "2026-01-31",
    comparison: "NONE",
    tab: "overview",
  });

  assert.equal(link.includes("from="), false, "a preset period needs no dates");
  assert.equal(link.includes("to="), false);
});
