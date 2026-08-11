import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["Sipariş Alındı", "Garson Onayladı", "Hazırlanıyor", "Hazır", "Servis Edildi"];

export function OrderStatusTimeline({ currentStep = 2 }: { currentStep?: number }) {
  return (
    <ol className="mt-5 space-y-0" aria-label="Sipariş durumu">
      {steps.map((step, index) => {
        const done = index < currentStep;
        const current = index === currentStep;
        return (
          <li key={step} className="relative flex min-h-14 gap-3">
            {index < steps.length - 1 ? <span className={cn("absolute left-[15px] top-8 h-7 w-px", done ? "bg-olive" : "bg-border")} /> : null}
            <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card", done && "border-olive bg-olive text-white", current && "border-copper text-copper", !done && !current && "border-border text-border")}>
              {done ? <Check className="size-4" /> : <Circle className={cn("size-2 fill-current", current && "animate-pulse")} />}
            </span>
            <div className="pt-1"><p className={cn("text-sm font-semibold", !done && !current && "text-muted-foreground")}>{step}</p>{current ? <p className="mt-0.5 text-xs text-muted-foreground">Mutfağımız siparişinizi hazırlıyor.</p> : null}</div>
          </li>
        );
      })}
    </ol>
  );
}
