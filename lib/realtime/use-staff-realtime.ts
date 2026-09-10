"use client";

import { useEffect, useRef, useState } from "react";

import { useStaffSession } from "@/components/staff/staff-session-provider";
import { restaurantStaffChannelName } from "@/lib/supabase/channels";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface StaffRealtimeEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

export type StaffRealtimeStatus = "unavailable" | "connecting" | "connected" | "reconnecting";

export interface StaffRealtimeOptions {
  /** Fired once per unique event id; Realtime delivery is at-least-once. */
  readonly onEvent?: (event: StaffRealtimeEvent) => void;
  /** Fired after a (re)connect so callers reload authoritative API state. */
  readonly onResync?: () => void;
}

/** Bounded so a long shift cannot grow the de-duplication set without limit. */
const SEEN_EVENT_LIMIT = 500;

function isRealtimeEvent(value: unknown): value is StaffRealtimeEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.eventId === "string" && typeof candidate.eventType === "string";
}

/**
 * One Supabase channel per restaurant for the whole panel. Components subscribe
 * through this hook instead of opening their own connections, so a panel with
 * several live lists still holds a single socket and a single lifecycle.
 */
export function useStaffRealtime(options: StaffRealtimeOptions = {}): StaffRealtimeStatus {
  const { restaurantId } = useStaffSession();
  const [status, setStatus] = useState<StaffRealtimeStatus>(() =>
    restaurantId && getSupabaseBrowserClient() ? "connecting" : "unavailable",
  );
  const handlersRef = useRef(options);

  useEffect(() => {
    handlersRef.current = options;
  });

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !restaurantId) return;

    const seenEvents = new Set<string>();
    const channel = client.channel(restaurantStaffChannelName(restaurantId), {
      config: { private: true },
    });

    channel.on("broadcast", { event: "*" }, (message: { payload?: unknown }) => {
      const payload = message.payload;
      if (!isRealtimeEvent(payload)) return;
      if (seenEvents.has(payload.eventId)) return;
      if (seenEvents.size >= SEEN_EVENT_LIMIT) {
        const oldest = seenEvents.values().next().value;
        if (oldest) seenEvents.delete(oldest);
      }
      seenEvents.add(payload.eventId);
      handlersRef.current.onEvent?.(payload);
    });

    channel.subscribe((channelStatus) => {
      if (channelStatus === "SUBSCRIBED") {
        setStatus("connected");
        // Also cover the gap between the initial API snapshot and the first
        // subscription: events emitted before SUBSCRIBED are not replayed.
        handlersRef.current.onResync?.();
        return;
      }
      if (channelStatus === "CLOSED") {
        setStatus("unavailable");
        return;
      }
      setStatus("reconnecting");
    });

    return () => {
      void client.removeChannel(channel);
    };
  }, [restaurantId]);

  return status;
}
