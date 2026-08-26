import "server-only";

import { getCustomerSessionSecret } from "@/lib/env/server";
import {
  createGuestOrderSession,
  verifyGuestOrderSession,
  type CreateGuestOrderSessionInput,
  type GuestOrderSessionClaims,
} from "./guest-order-session";

export function issueGuestOrderSession(input: CreateGuestOrderSessionInput): {
  token: string;
  claims: GuestOrderSessionClaims;
} {
  return createGuestOrderSession(input, getCustomerSessionSecret());
}

export function readGuestOrderSession(token: unknown): GuestOrderSessionClaims | null {
  return verifyGuestOrderSession(token, getCustomerSessionSecret());
}
