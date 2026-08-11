import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { WaiterCallsList } from "@/components/staff/waiter-calls-list";
import { waiterCalls } from "@/lib/mock-data/calls";

export const metadata: Metadata = {
  title: "Garson Çağrıları",
};

export default function StaffCallsPage() {
  const openCallCount = waiterCalls.filter((call) => call.status === "open").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Garson Çağrıları"
        description="Masa taleplerini önem sırasına göre üstlen ve tamamlanan çağrıları kapat."
        action={
          <Badge className="h-8 bg-burgundy px-3 text-sm text-primary-foreground">
            {openCallCount} bekleyen
          </Badge>
        }
      />
      <WaiterCallsList />
    </div>
  );
}
