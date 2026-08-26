import "server-only";

import { getQrTokenPepper } from "@/lib/env/server";
import {
  generateQrToken,
  hashQrToken,
  verifyQrToken,
  type GeneratedQrToken,
} from "./qr-token";

export function generateTableQrToken(): GeneratedQrToken {
  return generateQrToken(getQrTokenPepper());
}
export function hashTableQrToken(rawToken: string): string {
  return hashQrToken(rawToken, getQrTokenPepper());
}

export function verifyTableQrToken(candidate: unknown, storedHash: string): boolean {
  return verifyQrToken(candidate, storedHash, getQrTokenPepper());
}
