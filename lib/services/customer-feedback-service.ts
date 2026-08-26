import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { customerFeedback, orders } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";

export class CustomerFeedbackService {
  constructor(private readonly db: Database) {}

  async create(input: { restaurantId: string; tableId: string; tokenVersion: number; orderId: string | null; rating: number; foodRating: number | null; serviceRating: number | null; cleanlinessRating: number | null; comment: string | null }) {
    if (input.orderId) {
      const [order] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.restaurantId, input.restaurantId), eq(orders.tableId, input.tableId), eq(orders.id, input.orderId))).limit(1);
      if (!order) throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
    }
    const fingerprint = createHash("sha256").update(`${input.restaurantId}:${input.tableId}:${input.tokenVersion}`).digest("base64url");
    try {
      const [created] = await this.db.insert(customerFeedback).values({ restaurantId: input.restaurantId, tableId: input.tableId, orderId: input.orderId, sessionFingerprintHash: fingerprint, rating: input.rating, foodRating: input.foodRating, serviceRating: input.serviceRating, cleanlinessRating: input.cleanlinessRating, comment: input.comment }).returning({ id: customerFeedback.id, rating: customerFeedback.rating, createdAt: customerFeedback.createdAt });
      return created;
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505") throw new DomainError("CONFLICT", "Bu sipariş için geri bildirim zaten gönderildi.", { httpStatus: 409 });
      throw error;
    }
  }
}
