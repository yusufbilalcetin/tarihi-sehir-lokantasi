"use client";

import { CashierDashboard } from "@/components/cashier/cashier-dashboard";

/**
 * The till.
 *
 * A full operational screen. The cashier needs the list of open bills beside
 * the bill being settled, and squeezing that pair into a floating frame costs
 * the one comparison that prevents mistakes.
 */
export function CashierModule() {
  return <CashierDashboard />;
}
