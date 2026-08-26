import { DomainError } from "@/lib/api/domain-error";

/**
 * Phase 38 restaurant ERP domain primitives.
 *
 * Authoritative money and quantity calculations use bigint. JSON/API and DB
 * boundaries carry decimal strings; converting through Number would silently
 * lose precision for stock, recipe cost and supplier liabilities.
 */

export const INVENTORY_UNITS = ["MG", "G", "KG", "ML", "L", "UNIT", "PACKAGE", "CASE"] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

type UnitDefinition = {
  readonly dimension: "MASS" | "VOLUME" | "COUNT" | "PACKAGE" | "CASE";
  /** Canonical atoms per whole unit: mg, microlitre or one-millionth count. */
  readonly atomsPerUnit: bigint;
};

const UNIT_DEFINITIONS: Record<InventoryUnit, UnitDefinition> = {
  MG: { dimension: "MASS", atomsPerUnit: 1n },
  G: { dimension: "MASS", atomsPerUnit: 1_000n },
  KG: { dimension: "MASS", atomsPerUnit: 1_000_000n },
  ML: { dimension: "VOLUME", atomsPerUnit: 1_000n },
  L: { dimension: "VOLUME", atomsPerUnit: 1_000_000n },
  UNIT: { dimension: "COUNT", atomsPerUnit: 1_000_000n },
  // Pack and case sizes are supplier-item facts. Treating them as a count
  // conversion without that fact would invent inventory.
  PACKAGE: { dimension: "PACKAGE", atomsPerUnit: 1_000_000n },
  CASE: { dimension: "CASE", atomsPerUnit: 1_000_000n },
};

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

export function parseFixedDecimal(value: string, scale: number): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match || scale < 0 || !Number.isInteger(scale)) throw new Error("Geçersiz ondalık değer.");
  const fraction = match[3] ?? "";
  if (fraction.length > scale) throw new Error(`En fazla ${scale} ondalık basamak kullanılabilir.`);
  const sign = match[1] === "-" ? -1n : 1n;
  const factor = 10n ** BigInt(scale);
  return sign * (BigInt(match[2]) * factor + BigInt(fraction.padEnd(scale, "0") || "0"));
}

export function formatFixedDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const factor = 10n ** BigInt(scale);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}${scale ? `.${fraction}` : ""}`;
}

/** Converts a six-decimal user quantity to exact canonical atoms. */
export function quantityToAtoms(value: string, unit: InventoryUnit): bigint {
  const scaled = parseFixedDecimal(value, 6);
  return (scaled * UNIT_DEFINITIONS[unit].atomsPerUnit) / 1_000_000n;
}

export function convertQuantity(value: string, from: InventoryUnit, to: InventoryUnit): string {
  const source = UNIT_DEFINITIONS[from];
  const target = UNIT_DEFINITIONS[to];
  if (source.dimension !== target.dimension) throw new Error(`${from} birimi ${to} birimine çevrilemez.`);
  const atoms = quantityToAtoms(value, from);
  return formatFixedDecimal((atoms * 1_000_000n) / target.atomsPerUnit, 6);
}

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Bölen sıfırdan büyük olmalıdır.");
  if (numerator < 0n) return -roundRatio(-numerator, denominator);
  return (numerator + denominator / 2n) / denominator;
}

export type NegativeStockPolicy = "WARN" | "BLOCK";

/**
 * The negative-stock guard.
 *
 * A refusal has to say what is actually wrong. A bare `Error` here would be
 * redacted into "İşlem tamamlanamadı. Lütfen tekrar deneyin." by the API
 * envelope — advice that cannot work, because the retry fails identically. So
 * this throws a domain error carrying the amount that is genuinely on hand, and
 * the person reading it can decide to reduce the quantity or count the shelf.
 *
 * The guard itself is unchanged: the operation still fails. Only the sentence
 * improves.
 */
export function evaluateStockBalance(
  currentAtoms: bigint,
  deltaAtoms: bigint,
  policy: NegativeStockPolicy = "WARN",
  context: { readonly unit?: string } = {},
): { readonly nextAtoms: bigint; readonly warning: boolean } {
  const nextAtoms = currentAtoms + deltaAtoms;
  if (nextAtoms < 0n && policy === "BLOCK") {
    const available = formatFixedDecimal(currentAtoms > 0n ? currentAtoms : 0n, 6).replace(/\.?0+$/, "").replace(".", ",");
    const unit = context.unit ? ` ${context.unit}` : "";
    throw new DomainError(
      "CONFLICT",
      `Bu stok kalemi için yeterli miktar yok. Mevcut: ${available || "0"}${unit}. Miktarı azaltın veya önce stok girişi yapın.`,
      { httpStatus: 409 },
    );
  }
  return { nextAtoms, warning: nextAtoms < 0n };
}

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE_RECEIPT",
  "PRODUCTION_CONSUMPTION",
  "MANUAL_ADJUSTMENT",
  "WASTE",
  "STAFF_MEAL",
  "COMPLIMENTARY",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "COUNT_CORRECTION",
  "RETURN_TO_SUPPLIER",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export function movementDirection(type: StockMovementType): 1 | -1 | 0 {
  if (type === "PURCHASE_RECEIPT" || type === "TRANSFER_IN" || type === "COUNT_CORRECTION" || type === "MANUAL_ADJUSTMENT") return 0;
  return type === "TRANSFER_OUT" || type === "PRODUCTION_CONSUMPTION" || type === "WASTE" || type === "STAFF_MEAL" || type === "COMPLIMENTARY" || type === "RETURN_TO_SUPPLIER" ? -1 : 1;
}

/** Cost is returned as micro-minor-currency units per canonical atom. */
export function weightedAverageUnitCost(input: {
  readonly existingAtoms: bigint;
  readonly existingValueMinor: bigint;
  readonly receivedAtoms: bigint;
  readonly receivedValueMinor: bigint;
}): bigint {
  if (input.existingAtoms < 0n || input.receivedAtoms <= 0n) throw new Error("Maliyet için miktarlar geçersiz.");
  if (input.existingValueMinor < 0n || input.receivedValueMinor < 0n) throw new Error("Maliyet negatif olamaz.");
  const atoms = input.existingAtoms + input.receivedAtoms;
  return roundRatio((input.existingValueMinor + input.receivedValueMinor) * 1_000_000n, atoms);
}

export interface RecipeCostLine {
  readonly quantityAtoms: bigint;
  readonly unitCostMicrosPerAtom: bigint;
}

export function recipeCostMinor(lines: readonly RecipeCostLine[], yieldPortions: bigint): bigint {
  if (yieldPortions <= 0n) throw new Error("Reçete verimi sıfırdan büyük olmalıdır.");
  const batchCost = lines.reduce((total, line) => {
    if (line.quantityAtoms <= 0n || line.unitCostMicrosPerAtom < 0n) throw new Error("Reçete satırı geçersiz.");
    return total + roundRatio(line.quantityAtoms * line.unitCostMicrosPerAtom, 1_000_000n);
  }, 0n);
  return roundRatio(batchCost, yieldPortions);
}

export function contributionMetrics(sellingPriceMinor: bigint, recipeCost: bigint) {
  if (sellingPriceMinor < 0n || recipeCost < 0n) throw new Error("Fiyat veya maliyet negatif olamaz.");
  return {
    contributionMinor: sellingPriceMinor - recipeCost,
    foodCostBasisPoints: sellingPriceMinor === 0n ? null : roundRatio(recipeCost * 10_000n, sellingPriceMinor),
  } as const;
}

export interface RecipeConsumptionLine {
  readonly inventoryItemId: string;
  readonly batchQuantityAtoms: bigint;
}

export function productionConsumption(
  recipe: readonly RecipeConsumptionLine[],
  recipeYieldPortions: bigint,
  actualPortions: bigint,
): readonly RecipeConsumptionLine[] {
  if (recipeYieldPortions <= 0n || actualPortions <= 0n) throw new Error("Üretim porsiyonu sıfırdan büyük olmalıdır.");
  return recipe.map((line) => ({
    inventoryItemId: line.inventoryItemId,
    quantityAtoms: roundRatio(line.batchQuantityAtoms * actualPortions, recipeYieldPortions),
    batchQuantityAtoms: roundRatio(line.batchQuantityAtoms * actualPortions, recipeYieldPortions),
  }));
}

export function remainingProductionPortions(input: {
  readonly prepared: bigint;
  readonly sold: bigint;
  readonly waste: bigint;
  readonly staffMeal?: bigint;
  readonly complimentary?: bigint;
}): bigint {
  const values = [input.prepared, input.sold, input.waste, input.staffMeal ?? 0n, input.complimentary ?? 0n];
  if (values.some((value) => value < 0n)) throw new Error("Porsiyon miktarı negatif olamaz.");
  return input.prepared - input.sold - input.waste - (input.staffMeal ?? 0n) - (input.complimentary ?? 0n);
}

export function payableBalance(totalMinor: bigint, paymentsMinor: readonly bigint[]): bigint {
  if (totalMinor < 0n || paymentsMinor.some((value) => value < 0n)) throw new Error("Borç tutarı negatif olamaz.");
  return totalMinor - paymentsMinor.reduce((sum, value) => sum + value, 0n);
}

export interface ForecastObservation {
  readonly portions: bigint;
  readonly soldOut: boolean;
  readonly recencyRank: number;
}

/** Explainable recent-weighted average; sold-out-censored days are excluded. */
export function forecastPortions(observations: readonly ForecastObservation[]): bigint | null {
  const usable = observations.filter((item) => !item.soldOut && item.portions >= 0n).slice(0, 8);
  if (usable.length < 2) return null;
  let numerator = 0n;
  let denominator = 0n;
  for (const item of usable) {
    const weight = BigInt(Math.max(1, 5 - Math.max(0, item.recencyRank)));
    numerator += item.portions * weight;
    denominator += weight;
  }
  return roundRatio(numerator, denominator);
}

export type MenuEngineeringClass =
  | "HIGH_PERFORMANCE"
  | "POPULAR_LOW_MARGIN"
  | "HIGH_MARGIN_LOW_DEMAND"
  | "LOW_PERFORMANCE";

export function classifyMenuItem(input: {
  readonly quantitySold: bigint;
  readonly contributionMinor: bigint;
  readonly popularityThreshold: bigint;
  readonly contributionThresholdMinor: bigint;
}): MenuEngineeringClass {
  const popular = input.quantitySold >= input.popularityThreshold;
  const profitable = input.contributionMinor >= input.contributionThresholdMinor;
  if (popular && profitable) return "HIGH_PERFORMANCE";
  if (popular) return "POPULAR_LOW_MARGIN";
  if (profitable) return "HIGH_MARGIN_LOW_DEMAND";
  return "LOW_PERFORMANCE";
}

export interface SalesLine {
  readonly productId: string;
  readonly quantity: bigint;
  readonly orderStatus: "NEW" | "CONFIRMED" | "PREPARING" | "READY" | "SERVED" | "COMPLETED" | "CANCELLED";
  readonly itemStatus: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED" | "VOIDED";
  readonly occurredAt: Date;
}

export function aggregatePopularProducts(lines: readonly SalesLine[], now: Date, windowDays = 30) {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 366) throw new Error("Popülerlik penceresi geçersiz.");
  const earliest = now.getTime() - windowDays * 86_400_000;
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    if (line.occurredAt.getTime() < earliest || line.occurredAt.getTime() > now.getTime()) continue;
    if (!(["SERVED", "COMPLETED"] as const).includes(line.orderStatus as "SERVED" | "COMPLETED")) continue;
    if (line.itemStatus === "CANCELLED" || line.itemStatus === "VOIDED" || line.quantity <= 0n) continue;
    totals.set(line.productId, (totals.get(line.productId) ?? 0n) + line.quantity);
  }
  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.quantity === right.quantity ? left.productId.localeCompare(right.productId) : left.quantity > right.quantity ? -1 : 1);
}

export interface TimeRange { readonly startsAt: Date; readonly endsAt: Date }

export function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  if (left.endsAt <= left.startsAt || right.endsAt <= right.startsAt) throw new Error("Zaman aralığı geçersiz.");
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

export function workedMinutes(clockIn: Date, clockOut: Date | null, breakMinutes = 0): number | null {
  if (!clockOut) return null;
  const elapsed = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60_000) - breakMinutes;
  if (elapsed < 0 || !Number.isInteger(breakMinutes) || breakMinutes < 0) throw new Error("Puantaj süresi geçersiz.");
  return elapsed;
}

export function payrollNetPayable(grossMinor: bigint, allowancesMinor: bigint, deductionsMinor: bigint): bigint {
  if ([grossMinor, allowancesMinor, deductionsMinor].some((value) => value < 0n)) throw new Error("Bordro girdisi negatif olamaz.");
  return grossMinor + allowancesMinor - deductionsMinor;
}

export type LoyaltyEntryType = "EARN" | "REDEEM" | "ADJUST" | "EXPIRE";

export function loyaltyBalance(entries: readonly { readonly type: LoyaltyEntryType; readonly points: bigint }[]): bigint {
  return entries.reduce((balance, entry) => {
    if (entry.points <= 0n) throw new Error("Sadakat puanı sıfırdan büyük olmalıdır.");
    return balance + (entry.type === "EARN" || entry.type === "ADJUST" ? entry.points : -entry.points);
  }, 0n);
}

export type OrderChannel = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

export function requiresTable(channel: OrderChannel): boolean {
  return channel === "DINE_IN";
}

export function redactCustomerContact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 2)}${"*".repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-2)}`;
}
