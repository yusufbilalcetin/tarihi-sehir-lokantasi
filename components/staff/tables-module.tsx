"use client";

import { ServiceCockpit } from "@/components/staff/cockpit/service-cockpit";

/**
 * The waiter's screen.
 *
 * This used to be a page header over a floor plan and an attendance card. It is
 * now the service cockpit: on a phone, what needs a person followed by the room;
 * on a tablet, the room, the menu and the open table side by side. The cockpit
 * carries its own header and its own bottom bar, so the page is only this.
 */
export function TablesModule() {
  return <ServiceCockpit />;
}
