import "server-only";

import { getDb } from "@/db";
import { DrizzleOutboxRepository } from "@/lib/repositories/drizzle-outbox-repository";
import {
  OutboxDispatcher,
  type OutboxDispatcherOptions,
} from "@/lib/services/outbox-dispatcher";
import { SupabaseOutboxPublisher } from "@/lib/supabase/outbox-publisher.server";

export interface RealtimeOutboxRuntimeOptions extends OutboxDispatcherOptions {
  /** Per-event network timeout; keep batchSize * timeout below the route budget. */
  readonly transportTimeoutMs?: number;
}

/**
 * Runtime factory for a protected cron/worker invocation. Importing it is lazy:
 * the database and Supabase credentials are resolved only when called.
 */
export function createRealtimeOutboxDispatcher(
  options: RealtimeOutboxRuntimeOptions = {},
): OutboxDispatcher {
  const { transportTimeoutMs, ...dispatcherOptions } = options;
  return new OutboxDispatcher(
    new DrizzleOutboxRepository(getDb()),
    new SupabaseOutboxPublisher(undefined, transportTimeoutMs),
    dispatcherOptions,
  );
}
