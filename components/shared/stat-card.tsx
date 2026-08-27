import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, helper, icon: Icon, tone = "default" }: { label: string; value: string; helper?: string; icon: LucideIcon; tone?: "default" | "alert" | "success" }) {
  return (
    <div className={cn("rounded-lg border border-border/80 bg-card p-4 shadow-[var(--shadow-raised)]", tone === "alert" && "border-burgundy/25 bg-burgundy/[0.035]", tone === "success" && "border-olive/25 bg-olive/[0.035]")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
        </div>
        <div className="flex size-10 items-center justify-center rounded-md border border-copper/30 bg-muted/45 text-burgundy"><Icon className="size-5" strokeWidth={1.8} /></div>
      </div>
    </div>
  );
}
