import "server-only";

import { getDb } from "@/db";
import { DrizzleTableRepository } from "@/lib/repositories/drizzle-table-repository";
import { deriveTableQrLink, verifyTableQrLink } from "@/lib/security/qr-link-token.server";
import {
  generateTableQrToken,
  hashTableQrToken,
  verifyTableQrToken,
} from "@/lib/security/qr-token.server";
import { TableService } from "@/lib/services/table-service";

export function createTableService(): TableService {
  return new TableService(new DrizzleTableRepository(getDb()), {
    generate: generateTableQrToken,
    hash: hashTableQrToken,
    verify: verifyTableQrToken,
    deriveLink: deriveTableQrLink,
    verifyLink: verifyTableQrLink,
  });
}
