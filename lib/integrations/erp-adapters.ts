export type ExternalTransactionStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface ExternalOperationContext {
  readonly restaurantId: string;
  readonly idempotencyKey: string;
  readonly requestedByStaffId: string;
}

export interface PaymentTerminalAdapter {
  readonly provider: string;
  initiate(input: ExternalOperationContext & { readonly amountMinor: bigint; readonly currency: string }): Promise<{ readonly providerReference: string; readonly status: ExternalTransactionStatus }>;
  getStatus(providerReference: string): Promise<ExternalTransactionStatus>;
  cancel?(providerReference: string): Promise<ExternalTransactionStatus>;
  refund?(input: ExternalOperationContext & { readonly providerReference: string; readonly amountMinor: bigint }): Promise<ExternalTransactionStatus>;
  reconcile(input: { readonly restaurantId: string; readonly businessDate: string }): Promise<{ readonly matched: number; readonly unmatched: number }>;
}

export interface FiscalDocumentProvider {
  readonly provider: string;
  issue(input: ExternalOperationContext & { readonly documentType: "INVOICE" | "E_ARCHIVE"; readonly totalMinor: bigint; readonly currency: string; readonly legalPayload: Readonly<Record<string, unknown>> }): Promise<{ readonly externalReference: string; readonly status: ExternalTransactionStatus }>;
  getStatus(externalReference: string): Promise<ExternalTransactionStatus>;
  cancel?(externalReference: string): Promise<ExternalTransactionStatus>;
}

export interface FiscalDeviceAdapter {
  readonly vendor: string;
  saleReceipt(input: ExternalOperationContext & { readonly totalMinor: bigint; readonly paymentMethod: string }): Promise<{ readonly deviceReference: string; readonly status: ExternalTransactionStatus }>;
  status(deviceReference: string): Promise<ExternalTransactionStatus>;
  deviceHealth(): Promise<{ readonly available: boolean; readonly message?: string }>;
  cancel?(deviceReference: string): Promise<ExternalTransactionStatus>;
}

export interface AccountingAdapter {
  readonly provider: string;
  exportSales(input: ExternalOperationContext & { readonly from: Date; readonly to: Date }): Promise<{ readonly externalReference: string }>;
  exportPayments(input: ExternalOperationContext & { readonly from: Date; readonly to: Date }): Promise<{ readonly externalReference: string }>;
  exportSupplierInvoices(input: ExternalOperationContext & { readonly from: Date; readonly to: Date }): Promise<{ readonly externalReference: string }>;
  exportDailySummary(input: ExternalOperationContext & { readonly businessDate: string }): Promise<{ readonly externalReference: string }>;
}

/** Test-only adapter. Its name is deliberately explicit so it cannot masquerade as a live provider. */
export class TestPaymentTerminalAdapter implements PaymentTerminalAdapter {
  readonly provider = "TEST_ONLY";
  private readonly states = new Map<string, ExternalTransactionStatus>();

  async initiate(input: ExternalOperationContext & { readonly amountMinor: bigint; readonly currency: string }) {
    if (input.amountMinor <= 0n || !/^[A-Z]{3}$/.test(input.currency)) throw new Error("Geçersiz terminal isteği.");
    const existing = this.states.get(input.idempotencyKey);
    if (existing) return { providerReference: input.idempotencyKey, status: existing };
    this.states.set(input.idempotencyKey, "PENDING");
    return { providerReference: input.idempotencyKey, status: "PENDING" as const };
  }

  async getStatus(providerReference: string) { return this.states.get(providerReference) ?? "FAILED"; }
  async cancel(providerReference: string) { this.states.set(providerReference, "CANCELLED"); return "CANCELLED" as const; }
  async reconcile(input: { readonly restaurantId: string; readonly businessDate: string }) { void input; return { matched: this.states.size, unmatched: 0 }; }
}
