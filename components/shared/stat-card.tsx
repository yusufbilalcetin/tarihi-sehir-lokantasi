import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, helper, icon: Icon, tone = "default" }: { label: string; value: string; helper?: string; icon: LucideIcon; tone?: "default" | "alert" | "success" }) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4 shadow-[0_10px_30px_rgba(104,31,37,0.05)]", tone === "alert" && "border-burgundy/20 bg-burgundy/[0.045]", tone === "success" && "border-olive/20 bg-olive/[0.045]")}> 
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
        </div>
        <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-background text-burgundy"><Icon className="size-5" strokeWidth={1.8} /></div>
      </div>
    </div>
  );
}
