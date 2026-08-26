import type { ClaimedOutboxEvent } from "@/lib/repositories/outbox-repository";
import type { OutboxEventPublisher } from "@/lib/services/outbox-dispatcher";
import { restaurantStaffChannelName } from "@/lib/supabase/channels";
import { createSafeRealtimeEnvelope } from "./safe-event";

export interface PrivateRealtimeTransport {
  sendPrivate(
    topic: string,
    event: string,
    payload: unknown,
  ): Promise<void>;
}

/**
 * Publishes a minimal DTO to an authenticated, restaurant-scoped staff topic.
 * Customer table/order topics need their own short-lived Realtime identity and
 * are intentionally not made public by this foundation.
 */
export class RestaurantEventPublisher implements OutboxEventPublisher {
  constructor(private readonly transport: PrivateRealtimeTransport) {}

  publish(event: ClaimedOutboxEvent): Promise<void> {
    return this.transport.sendPrivate(
      restaurantStaffChannelName(event.restaurantId),
      event.eventType,
      createSafeRealtimeEnvelope(event),
    );
  }
}
