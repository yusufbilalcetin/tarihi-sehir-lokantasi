"use client";

import { StaffTablesView } from "@/components/staff/staff-tables-view";

/**
 * The floor plan.
 *
 * `StaffTablesView` renders its own page header, so this is the whole page:
 * the staff shell above it already says where the waiter is.
 */
export function TablesModule() {
  return <StaffTablesView />;
}
