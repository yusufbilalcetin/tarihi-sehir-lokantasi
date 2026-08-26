import type { UserRole } from "@/lib/domain/status";

export const PANEL_ROLE_ACCESS = {
  admin: ["ADMIN", "MANAGER"],
  staff: ["ADMIN", "MANAGER", "WAITER"],
  kitchen: ["ADMIN", "MANAGER", "KITCHEN"],
  cashier: ["ADMIN", "MANAGER", "CASHIER"],
} as const satisfies Record<string, readonly UserRole[]>;

export type PanelArea = keyof typeof PANEL_ROLE_ACCESS;

export function canAccessPanel(role: UserRole, area: PanelArea): boolean {
  return (PANEL_ROLE_ACCESS[area] as readonly UserRole[]).includes(role);
}
/**
 * Paths the proxy guards. `/staff/login` is deliberately absent: the proxy
 * matcher covers it so the page can receive a CSP nonce, and treating it as
 * protected would redirect it to itself for ever.
 *
 * Kept here rather than in `proxy.ts` so it carries no server-only imports and
 * can be asserted directly by the unit tests.
 */
const PROTECTED_STAFF_PREFIXES = [
  "/admin",
  "/cashier",
  "/kitchen",
  "/staff/dashboard",
  "/staff/orders",
  "/staff/tables",
  "/staff/calls",
] as const;

export function isProtectedStaffPath(pathname: string): boolean {
  return PROTECTED_STAFF_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function staffHomeForRole(role: UserRole): string {
  switch (role) {
    case "ADMIN":
    case "MANAGER":
      return "/admin/dashboard";
    case "KITCHEN":
      return "/kitchen";
    case "CASHIER":
      return "/cashier";
    case "WAITER":
      return "/staff/dashboard";
  }
}
