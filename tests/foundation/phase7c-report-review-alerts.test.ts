import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REVIEW_THRESHOLDS,
  buildReviewReport,
  type StaffActivity,
} from "../../lib/domain/report-review";

function staff(overrides: Partial<StaffActivity> & { staffId: string }): StaffActivity {
  return {
    staffName: `Personel ${overrides.staffId}`,
    role: "WAITER",
    isActive: true,
    totalActions: 0,
    cancelCount: 0,
    voidCount: 0,
    refundCount: 0,
    cancelledAmountMinor: 0,
    voidedAmountMinor: 0,
    refundedAmountMinor: 0,
    ...overrides,
  };
}

test("the same count on very different volumes is not the same signal", () => {
  // Both cancelled 30 times; only one of them did so at an unusual rate.
  const report = buildReviewReport([
    staff({ staffId: "busy", totalActions: 5000, cancelCount: 30 }),
    staff({ staffId: "quiet", totalActions: 100, cancelCount: 30 }),
  ]);

  const busy = report.staff.find((entry) => entry.staffId === "busy");
  const quiet = report.staff.find((entry) => entry.staffId === "quiet");
  assert.equal(busy?.cancelRate, 0.6);
  assert.equal(quiet?.cancelRate, 30);
  assert.equal(busy?.signals.length, 0, "a 0.6% rate must not be flagged");
  assert.equal(quiet?.signals.length, 1, "a 30% rate should be surfaced");
  assert.equal(quiet?.signals[0]?.kind, "CANCEL_RATE");
});

test("the comparison is the period's own peer average", () => {
  const report = buildReviewReport([
    staff({ staffId: "a", totalActions: 1000, cancelCount: 20 }),
    staff({ staffId: "b", totalActions: 1000, cancelCount: 20 }),
    staff({ staffId: "c", totalActions: 100, cancelCount: 30 }),
  ]);

  // 70 cancels over 2100 actions.
  assert.equal(report.peerAverages.cancelRate, 3.3);
  const flagged = report.flagged.find((entry) => entry.staffId === "c");
  assert.ok(flagged);
  assert.equal(flagged.signals[0]?.peerAverageRate, 3.3);
  assert.equal(flagged.signals[0]?.rate, 30);
});

test("a small sample never raises a rate signal", () => {
  // 5 actions, all cancelled: a 100% rate, but far below the sample floor.
  const report = buildReviewReport([
    staff({ staffId: "new", totalActions: 5, cancelCount: 5 }),
    staff({ staffId: "busy", totalActions: 5000, cancelCount: 25 }),
  ]);

  const newcomer = report.staff.find((entry) => entry.staffId === "new");
  assert.equal(newcomer?.cancelRate, 100, "the rate is still reported");
  assert.equal(newcomer?.signals.length, 0, "but it must not be flagged");
  assert.equal(report.flagged.length, 0);
});

test("the sample floor is configurable, not hard-coded in a component", () => {
  const activity = [
    staff({ staffId: "small", totalActions: 10, cancelCount: 8 }),
    staff({ staffId: "busy", totalActions: 5000, cancelCount: 25 }),
  ];
  assert.equal(buildReviewReport(activity).flagged.length, 0);

  const lenient = buildReviewReport(activity, {
    ...DEFAULT_REVIEW_THRESHOLDS,
    minimumTransactionsForRateAlert: 5,
  });
  assert.equal(lenient.flagged.length, 1);
  assert.equal(lenient.flagged[0]?.staffId, "small");
});

test("void and refund rates are separate signals from cancellation", () => {
  const report = buildReviewReport([
    staff({
      staffId: "a",
      totalActions: 200,
      voidCount: 40,
      refundCount: 30,
      refundedAmountMinor: 10_000,
    }),
    staff({ staffId: "b", totalActions: 2000, voidCount: 10, refundCount: 5 }),
  ]);

  const flagged = report.flagged.find((entry) => entry.staffId === "a");
  assert.ok(flagged);
  const kinds = flagged.signals.map((signal) => signal.kind).sort();
  assert.deepEqual(kinds, ["REFUND_RATE", "VOID_RATE"]);
});

test("a large refund total is surfaced regardless of how busy the person was", () => {
  // 6.000,00 TL returned across only a handful of actions.
  const report = buildReviewReport([
    staff({ staffId: "a", totalActions: 4, refundCount: 1, refundedAmountMinor: 600_000 }),
  ]);

  const flagged = report.flagged.find((entry) => entry.staffId === "a");
  assert.ok(flagged, "an absolute money signal has no sample-size floor");
  assert.deepEqual(
    flagged.signals.map((signal) => signal.kind),
    ["REFUND_AMOUNT"],
  );
  assert.equal(flagged.signals[0]?.amountMinor, 600_000);
});

test("no peer activity means nothing to be above", () => {
  const report = buildReviewReport([
    staff({ staffId: "a", totalActions: 100 }),
    staff({ staffId: "b", totalActions: 100 }),
  ]);
  assert.equal(report.peerAverages.cancelRate, 0);
  assert.equal(report.flagged.length, 0);
});

test("an empty period produces an empty, non-throwing report", () => {
  const report = buildReviewReport([]);
  assert.deepEqual(report.staff, []);
  assert.deepEqual(report.flagged, []);
  assert.equal(report.peerAverages.cancelRate, 0);
  assert.equal(report.peerAverages.refundRate, 0);
});

test("an inactive staff member keeps their history and is marked, not dropped", () => {
  const report = buildReviewReport([
    staff({ staffId: "gone", isActive: false, totalActions: 300, cancelCount: 60 }),
    staff({ staffId: "here", totalActions: 3000, cancelCount: 15 }),
  ]);

  const historical = report.staff.find((entry) => entry.staffId === "gone");
  assert.ok(historical, "a departed staff member must not vanish from the report");
  assert.equal(historical.isActive, false);
  assert.equal(historical.signals.length, 1);
});

test("the wording is a review prompt, never a verdict", () => {
  const report = buildReviewReport([
    staff({ staffId: "a", totalActions: 100, cancelCount: 30 }),
    staff({ staffId: "b", totalActions: 3000, cancelCount: 15 }),
  ]);

  const forbidden = ["hırsız", "dolandırıcı", "fraud", "theft", "suç", "şüpheli"];
  for (const entry of report.flagged) {
    for (const signal of entry.signals) {
      const message = signal.message.toLocaleLowerCase("tr-TR");
      for (const word of forbidden) {
        assert.equal(
          message.includes(word),
          false,
          `the review message must not accuse anyone: found "${word}"`,
        );
      }
      assert.ok(
        message.includes("inceleme") || message.includes("ortalama"),
        "the message should point at a review, not a conclusion",
      );
    }
  }
});

test("people with the most signals are listed first", () => {
  const report = buildReviewReport([
    staff({ staffId: "one", totalActions: 200, cancelCount: 40 }),
    staff({
      staffId: "three",
      totalActions: 200,
      cancelCount: 40,
      voidCount: 40,
      refundCount: 40,
      refundedAmountMinor: 900_000,
    }),
    staff({ staffId: "clean", totalActions: 4000, cancelCount: 20, voidCount: 20, refundCount: 20 }),
  ]);

  assert.equal(report.flagged[0]?.staffId, "three");
  assert.ok((report.flagged[0]?.signals.length ?? 0) > (report.flagged[1]?.signals.length ?? 0));
});
