import "server-only";

import { getCustomerSessionSecret } from "@/lib/env/server";
import {
  createCustomerTableSession,
  verifyCustomerTableSession,
  type CreateCustomerTableSessionInput,
  type CustomerTableSessionClaims,
} from "./customer-session";

export function issueCustomerTableSession(input: CreateCustomerTableSessionInput): {
  token: string;
  claims: CustomerTableSessionClaims;
} {
  return createCustomerTableSession(input, getCustomerSessionSecret());
}
export function readCustomerTableSession(token: unknown): CustomerTableSessionClaims | null {
  return verifyCustomerTableSession(token, getCustomerSessionSecret());
}
