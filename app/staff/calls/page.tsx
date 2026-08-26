import type { Metadata } from "next";
import { CallsModule } from "@/components/staff/calls-module";

export const metadata: Metadata = {
  title: "Garson Çağrıları",
};

export default function StaffCallsPage() {
  return <CallsModule />;
}
