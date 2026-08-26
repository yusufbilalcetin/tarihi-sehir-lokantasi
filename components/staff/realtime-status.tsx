"use client";

import { RefreshCw, WifiOff } from "lucide-react";

import type { StaffRealtimeStatus } from "@/lib/realtime/use-staff-realtime";
import { cn } from "@/lib/utils";

const LABELS: Record<StaffRealtimeStatus, string | null> = {
  connected: null,
  connecting: "Canlı bağlantı kuruluyor",
  reconnecting: "Bağlantı yeniden kuruluyor",
  unavailable: "Canlı bağlantı yok, liste düzenli olarak yenileniyor",
};

/**
 * Only surfaces when live delivery is degraded, so a healthy panel keeps its
 * original layout untouched.
 */
export function RealtimeStatus({ status, className }: { status: StaffRealtimeStatus; className?: string }) {
  const label = LABELS[status];
  if (!label) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-status-warning/25 bg-status-warning-tint px-2.5 py-1.5 text-xs font-semibold text-status-warning",
        className,
      )}
    >
      {status === "unavailable"
        ? <WifiOff className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
        : <RefreshCw className="size-3.5 animate-spin" strokeWidth={1.8} aria-hidden="true" />}
      {label}
    </p>
  );
}
