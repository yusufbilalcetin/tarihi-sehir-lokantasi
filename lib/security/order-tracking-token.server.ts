import "server-only";

import { getCustomerSessionSecret } from "@/lib/env/server";
import {
  createOrderTrackingToken,
  verifyOrderTrackingToken,
  type CreateOrderTrackingTokenInput,
  type OrderTrackingClaims,
} from "./order-tracking-token";

export function issueOrderTrackingToken(input: CreateOrderTrackingTokenInput): {
  token: string;
  claims: OrderTrackingClaims;
} {
  return createOrderTrackingToken(input, getCustomerSessionSecret());
}

export function readOrderTrackingToken(token: unknown): OrderTrackingClaims | null {
  return verifyOrderTrackingToken(token, getCustomerSessionSecret());
}
