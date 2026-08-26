"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { UserRole } from "@/lib/domain/status";

export interface StaffSession {
  /** Null for legacy HMAC sessions, which have no database tenant. */
  readonly restaurantId: string | null;
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
  role,
  name,
  staffId,
  children,
}: StaffSession & { children: ReactNode }) {
  const value = useMemo(
    () => ({ restaurantId, role, name, staffId }),
    [restaurantId, role, name, staffId],
  );
  return <StaffSessionContext.Provider value={value}>{children}</StaffSessionContext.Provider>;
}

export function useStaffSession(): StaffSession {
  const session = useContext(StaffSessionContext);
  if (!session) throw new Error("useStaffSession must be used inside StaffSessionProvider.");
  return session;
}
