/**
 * Operational review signals.
 *
 * This is not an accusation system. It surfaces rates that sit above the
 * period's own average so a manager can look, and it deliberately produces no
 * verdict, no score and no language about theft or fraud. Every rule here is
 * deterministic and explainable from the numbers it was given.
 */

export interface ReviewThresholds {
  /** Below this many actions a rate is noise, so no signal is raised. */
  readonly minimumTransactionsForRateAlert: number;
  /** Multiples of the peer average at which a rate becomes worth a look. */
  readonly cancelRateAlert: number;
  readonly voidRateAlert: number;
  readonly refundRateAlert: number;
  /** Absolute money returned by one person in the period. */
  readonly refundAmountAlert: number;
}

export const DEFAULT_REVIEW_THRESHOLDS: ReviewThresholds = {
  minimumTransactionsForRateAlert: 25,
  cancelRateAlert: 2.5,
  voidRateAlert: 2.5,
  refundRateAlert: 2.5,
  refundAmountAlert: 5_000,
};

export interface StaffActivity {
  readonly staffId: string;
  readonly staffName: string;
  readonly role: string;
  readonly isActive: boolean;
  /** Everything this person did in the period; the denominator for rates. */
  readonly totalActions: number;
  readonly cancelCount: number;
  readonly voidCount: number;
  readonly refundCount: number;
  readonly cancelledAmountMinor: number;
  readonly voidedAmountMinor: number;
  readonly refundedAmountMinor: number;
}

export type ReviewSignalKind =
  | "CANCEL_RATE"
  | "VOID_RATE"
  | "REFUND_RATE"
  | "REFUND_AMOUNT";

export interface ReviewSignal {
  readonly kind: ReviewSignalKind;
  /** The person's own rate, as a percentage of their actions. */
  readonly rate: number;
  /** The same rate across everyone in the period, for context. */
  readonly peerAverageRate: number;
  readonly count: number;
  readonly amountMinor: number;
  /** Neutral, non-judgemental wording for the panel. */
  readonly message: string;
}

export interface StaffReviewResult {
  readonly staffId: string;
  readonly staffName: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly totalActions: number;
  readonly cancelRate: number;
  readonly voidRate: number;
  readonly refundRate: number;
  readonly signals: readonly ReviewSignal[];
}

export interface ReviewReport {
  readonly thresholds: ReviewThresholds;
  readonly peerAverages: {
    readonly cancelRate: number;
    readonly voidRate: number;
    readonly refundRate: number;
  };
  readonly staff: readonly StaffReviewResult[];
  /** Only the people with at least one signal, most signals first. */
  readonly flagged: readonly StaffReviewResult[];
}

function rate(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function peerRate(
  activity: readonly StaffActivity[],
  pick: (entry: StaffActivity) => number,
): number {
  const actions = activity.reduce((total, entry) => total + entry.totalActions, 0);
  const events = activity.reduce((total, entry) => total + pick(entry), 0);
  return rate(events, actions);
}

const MESSAGES: Readonly<Record<ReviewSignalKind, string>> = {
  CANCEL_RATE: "İptal oranı dönem ortalamasının üzerinde. Yönetici incelemesi önerilir.",
  VOID_RATE:
    "Hesaptan çıkarma oranı dönem ortalamasının üzerinde. Yönetici incelemesi önerilir.",
  REFUND_RATE: "İade oranı dönem ortalamasının üzerinde. Yönetici incelemesi önerilir.",
  REFUND_AMOUNT: "İade tutarı dönem eşiğinin üzerinde. Yönetici incelemesi önerilir.",
};

/**
 * Compares each person against the period's own peer average rather than an
 * absolute figure, so 30 cancellations in 5000 actions and 30 in 100 are not
 * treated alike. People below the sample-size floor are reported with their
 * numbers but never flagged.
 */
export function buildReviewReport(
  activity: readonly StaffActivity[],
  thresholds: ReviewThresholds = DEFAULT_REVIEW_THRESHOLDS,
): ReviewReport {
  const peerAverages = {
    cancelRate: peerRate(activity, (entry) => entry.cancelCount),
    voidRate: peerRate(activity, (entry) => entry.voidCount),
    refundRate: peerRate(activity, (entry) => entry.refundCount),
  };

  const staff = activity.map((entry): StaffReviewResult => {
    const cancelRate = rate(entry.cancelCount, entry.totalActions);
    const voidRate = rate(entry.voidCount, entry.totalActions);
    const refundRate = rate(entry.refundCount, entry.totalActions);
    const signals: ReviewSignal[] = [];

    const enoughSample = entry.totalActions >= thresholds.minimumTransactionsForRateAlert;

    function consider(
      kind: Exclude<ReviewSignalKind, "REFUND_AMOUNT">,
      value: number,
      average: number,
      multiplier: number,
      count: number,
      amountMinor: number,
    ) {
      if (!enoughSample || count === 0) return;
      // With no peer activity at all there is nothing to be "above".
      if (average <= 0) return;
      if (value >= average * multiplier) {
        signals.push({
          kind,
          rate: value,
          peerAverageRate: average,
          count,
          amountMinor,
          message: MESSAGES[kind],
        });
      }
    }

    consider(
      "CANCEL_RATE",
      cancelRate,
      peerAverages.cancelRate,
      thresholds.cancelRateAlert,
      entry.cancelCount,
      entry.cancelledAmountMinor,
    );
    consider(
      "VOID_RATE",
      voidRate,
      peerAverages.voidRate,
      thresholds.voidRateAlert,
      entry.voidCount,
      entry.voidedAmountMinor,
    );
    consider(
      "REFUND_RATE",
      refundRate,
      peerAverages.refundRate,
      thresholds.refundRateAlert,
      entry.refundCount,
      entry.refundedAmountMinor,
    );

    // An absolute money signal needs no sample-size floor: one very large
    // refund is worth seeing regardless of how busy the person was.
    if (entry.refundedAmountMinor >= thresholds.refundAmountAlert * 100) {
      signals.push({
        kind: "REFUND_AMOUNT",
        rate: refundRate,
        peerAverageRate: peerAverages.refundRate,
        count: entry.refundCount,
        amountMinor: entry.refundedAmountMinor,
        message: MESSAGES.REFUND_AMOUNT,
      });
    }

    return {
      staffId: entry.staffId,
      staffName: entry.staffName,
      role: entry.role,
      isActive: entry.isActive,
      totalActions: entry.totalActions,
      cancelRate,
      voidRate,
      refundRate,
      signals,
    };
  });

  return {
    thresholds,
    peerAverages,
    staff,
    flagged: staff
      .filter((entry) => entry.signals.length > 0)
      .sort((left, right) => right.signals.length - left.signals.length),
  };
}
