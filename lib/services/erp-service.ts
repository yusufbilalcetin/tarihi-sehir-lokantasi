import { DomainError, validationError } from "@/lib/api/domain-error";
import { formatFixedDecimal, parseFixedDecimal, roundRatio } from "@/lib/domain/erp";
import type { ErpRepository } from "@/lib/repositories/erp-repository";
import type { ErpCommand } from "@/lib/validation/erp";

export class ErpService {
  constructor(private readonly repository: ErpRepository) {}

  overview(restaurantId: string) { return this.repository.overview(restaurantId); }

  execute(restaurantId: string, staffId: string, requestId: string, command: ErpCommand) {
    const audit = { actorStaffId: staffId, requestId };
    switch (command.command) {
      case "CREATE_WAREHOUSE":
        return this.repository.createWarehouse({ restaurantId, name: command.name, code: command.code, audit });
      case "CREATE_INVENTORY_ITEM":
        return this.repository.createInventoryItem({ restaurantId, name: command.name, category: command.category, baseUnit: command.baseUnit, reorderLevel: command.reorderLevel.replace(",", "."), negativeStockPolicy: command.negativeStockPolicy, audit });
      case "POST_STOCK_MOVEMENT": {
        const delta = parseFixedDecimal(command.quantityDelta, 6);
        const inherentlyOutgoing = ["PRODUCTION_CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "TRANSFER_OUT", "RETURN_TO_SUPPLIER"].includes(command.movementType);
        const inherentlyIncoming = ["PURCHASE_RECEIPT", "TRANSFER_IN"].includes(command.movementType);
        if (inherentlyOutgoing && delta > 0n) throw validationError("Bu hareket türü stoktan düşmelidir; negatif miktar girin.");
        if (inherentlyIncoming && delta < 0n) throw validationError("Bu hareket türü stoğu artırmalıdır; pozitif miktar girin.");
        return this.repository.postStockMovement({ restaurantId, ...command, quantityDelta: command.quantityDelta.replace(",", "."), unitCost: command.unitCost?.replace(",", ".") ?? null, audit });
      }
      case "CREATE_RECIPE": {
        const uniqueItems = new Set(command.ingredients.map((line) => line.inventoryItemId));
        if (uniqueItems.size !== command.ingredients.length) throw new DomainError("CONFLICT", "Aynı stok kalemi reçetede bir kez yer alabilir.", { httpStatus: 409 });
        return this.repository.createRecipe({ restaurantId, productId: command.productId, yieldPortions: command.yieldPortions.replace(",", "."), ingredients: command.ingredients.map((line) => ({ ...line, quantity: line.quantity.replace(",", ".") })), audit });
      }
      case "CREATE_SUPPLIER":
        return this.repository.createSupplier({ restaurantId, ...command, audit });
      case "CREATE_SCHEDULE":
        if (command.endsAt <= command.startsAt) throw validationError("Vardiya zaman aralığı geçersiz.");
        return this.repository.createSchedule({ restaurantId, ...command, audit });
      case "CREATE_RESERVATION":
        if (command.endsAt <= command.startsAt) throw validationError("Rezervasyon zaman aralığı geçersiz.");
        return this.repository.createReservation({ restaurantId, ...command, audit });
      case "CREATE_CUSTOMER_ACCOUNT":
        if (!command.email && !command.phone) throw validationError("Müşteri hesabı için e-posta ya da telefon girin.");
        return this.repository.createCustomerAccount({ restaurantId, ...command, audit });
      case "CREATE_FULFILLMENT_REQUEST": {
        const uniqueProducts = new Set(command.items.map((line) => line.productId));
        if (uniqueProducts.size !== command.items.length) throw new DomainError("CONFLICT", "Aynı ürün siparişte bir kez yer alabilir; adedini artırın.", { httpStatus: 409 });
        return this.repository.createFulfillmentRequest({ restaurantId, channel: command.channel, customerName: command.customerName, contact: command.contact, address: command.address, deliveryNotes: command.deliveryNotes, requestedAt: command.requestedAt, deliveryFee: command.deliveryFee.replace(",", "."), idempotencyKey: command.idempotencyKey, items: command.items, audit });
      }
      case "REFRESH_POPULAR":
        return this.repository.refreshPopularProducts({ restaurantId, windowDays: command.windowDays, audit });
      case "CREATE_PRODUCTION_BATCH":
        return this.repository.createProductionBatch({ restaurantId, ...command, plannedPortions: command.plannedPortions.replace(",", "."), audit });
      case "COMPLETE_PRODUCTION_BATCH":
        return this.repository.completeProductionBatch({ restaurantId, batchId: command.batchId, actualPortions: command.actualPortions.replace(",", "."), audit });
      case "RECORD_WASTE":
        return this.repository.recordWaste({ restaurantId, ...command, quantity: command.quantity.replace(",", "."), estimatedCost: command.estimatedCost.replace(",", "."), audit });
      case "CREATE_PURCHASE_ORDER":
        return this.repository.createPurchaseOrder({ restaurantId, supplierId: command.supplierId, orderNumber: command.orderNumber, expectedAt: command.expectedAt, notes: command.notes, items: command.items.map((line) => {
          const quantity = line.orderedQuantity.replace(",", ".");
          const unitPrice = line.unitPrice.replace(",", ".");
          const totalMinor = roundRatio(parseFixedDecimal(quantity, 6) * parseFixedDecimal(unitPrice, 2), 1_000_000n);
          return { ...line, orderedQuantity: quantity, unitPrice, lineTotal: formatFixedDecimal(totalMinor, 2) };
        }), audit });
      case "RECEIVE_GOODS":
        return this.repository.receiveGoods({ restaurantId, ...command, items: command.items.map((line) => ({ ...line, receivedQuantity: line.receivedQuantity.replace(",", "."), unitPrice: line.unitPrice.replace(",", ".") })), audit });
      case "CREATE_SUPPLIER_INVOICE":
        return this.repository.createSupplierInvoice({ restaurantId, ...command, total: command.total.replace(",", "."), audit });
      case "RECORD_SUPPLIER_PAYMENT":
        return this.repository.recordSupplierPayment({ restaurantId, ...command, amount: command.amount.replace(",", "."), audit });
    }
  }
}
