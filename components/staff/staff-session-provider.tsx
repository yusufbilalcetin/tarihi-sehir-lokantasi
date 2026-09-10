"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { UserRole } from "@/lib/domain/status";

export interface StaffSession {
  /** Null for legacy HMAC sessions, which have no database tenant. */
  readonly restaurantId: string | null;
  /**
   * The restaurant's own name, as it is stored. Null on legacy sessions, which
   * have no tenant. Carried here so no screen has to write it out as a literal
   * and then disagree with the database the day it is renamed.
   */
  readonly restaurantName: string | null;
  /**
   * The restaurant's IANA zone. Every screen that has to decide what "today"
   * means reads it from here, so there is one answer rather than one per
   * screen — and a restaurant outside Türkiye gets its own day boundary.
   */
  readonly restaurantTimezone: string;
  readonly role: UserRole;
  readonly name: string;
  /**
   * The signed-in staff profile's own id, so a screen can tell "me" from
   * "a colleague". Never used for authorization — the server derives that from
   * the session itself, never from anything the browser holds.
   */
  readonly staffId: string;
}

const StaffSessionContext = createContext<StaffSession | null>(null);

export function StaffSessionProvider({
  restaurantId,
  restaurantName,
  restaurantTimezone,
  role,
  name,
  staffId,
  children,
}: StaffSession & { children: ReactNode }) {
  const value = useMemo(
    () => ({ restaurantId, restaurantName, restaurantTimezone, role, name, staffId }),
    [restaurantId, restaurantName, restaurantTimezone, role, name, staffId],
  );
  return <StaffSessionContext.Provider value={value}>{children}</StaffSessionContext.Provider>;
}

export function useStaffSession(): StaffSession {
  const session = useContext(StaffSessionContext);
  if (!session) throw new Error("useStaffSession must be used inside StaffSessionProvider.");
  return session;
}
