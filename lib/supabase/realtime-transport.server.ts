import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrivateRealtimeTransport } from "@/lib/realtime/restaurant-event-publisher";
import { getSupabaseAdminClient } from "./admin";

/** Server-to-Realtime REST transport; no persistent WebSocket is required. */
export class SupabasePrivateRealtimeTransport implements PrivateRealtimeTransport {
  constructor(
    private readonly client: SupabaseClient = getSupabaseAdminClient(),
    private readonly timeoutMs = 10_000,
  ) {}

  async sendPrivate(topic: string, event: string, payload: unknown): Promise<void> {
    const channel = this.client.channel(topic, { config: { private: true } });
    try {
      const result = await channel.httpSend(event, payload, {
        timeout: this.timeoutMs,
      });
      if (!result.success) {
        throw new Error(`Supabase Realtime rejected the event (${result.status}).`);
      }
    } finally {
      await this.client.removeChannel(channel);
    }
  }
}
