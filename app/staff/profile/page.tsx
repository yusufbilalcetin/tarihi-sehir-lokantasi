import type { Metadata } from "next";
import { StaffProfileView } from "@/components/staff/cockpit/staff-profile-view";

export const metadata: Metadata = {
  title: "Profil",
};

/**
 * The waiter's own page: clocking in, their next shifts, their account.
 *
 * A phone reaches this through the Profil tab of the service cockpit. A tablet
 * has no bottom bar, so without this route a waiter working from a stand could
 * not clock in at all once the personal cards left the tables screen.
 */
export default function StaffProfilePage() {
  return <StaffProfileView className="mx-auto w-full max-w-2xl" />;
}
