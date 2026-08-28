import "server-only";

import { getQrTokenPepper } from "@/lib/env/server";
import {
  deriveQrLinkToken,
  verifyQrLinkToken,
  type QrLinkClaims,
} from "./qr-link-token";

export function deriveTableQrLink(claims: QrLinkClaims): string {
  return deriveQrLinkToken(claims, getQrTokenPepper());
}

export function verifyTableQrLink(candidate: unknown, claims: QrLinkClaims): boolean {
  return verifyQrLinkToken(candidate, claims, getQrTokenPepper());
}
