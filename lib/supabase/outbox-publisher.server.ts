import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { RestaurantEventPublisher } from "@/lib/realtime/restaurant-event-publisher";
import { SupabasePrivateRealtimeTransport } from "./realtime-transport.server";

/**
 * Compatibility-facing publisher name backed by the safe DTO projector and
 * acknowledged private REST Broadcast transport.
 */
export class SupabaseOutboxPublisher extends RestaurantEventPublisher {
  constructor(client?: SupabaseClient, timeoutMs?: number) {
    super(new SupabasePrivateRealtimeTransport(client, timeoutMs));
  }
}
