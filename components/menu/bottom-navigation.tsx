import { BellRing, ClipboardList, ReceiptText, UtensilsCrossed } from "lucide-react";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { cn } from "@/lib/utils";

export type MenuTab = "menu" | "order" | "waiter" | "bill";

const items = [
  { id: "menu" as const, labelKey: "menu" as const, icon: UtensilsCrossed },
  { id: "order" as const, labelKey: "order" as const, icon: ClipboardList },
  { id: "waiter" as const, labelKey: "waiter" as const, icon: BellRing },
  { id: "bill" as const, labelKey: "bill" as const, icon: ReceiptText },
];

export function BottomNavigation({ active, cartCount, onChange }: { active: MenuTab; cartCount: number; onChange: (tab: MenuTab) => void }) {
  const { direction, formatNumber, t } = useMenuPreferences();

  return (
    <nav dir={direction} aria-label={t("customerNavigation")} className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/96 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(37,33,29,0.1)] backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-xl grid-cols-4 px-2">
        {items.map(({ id, labelKey, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onChange(id)} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active === id ? "text-burgundy" : "text-muted-foreground hover:text-foreground")} aria-current={active === id ? "page" : undefined}>
            <Icon className="size-5" strokeWidth={active === id ? 2.2 : 1.7} />
            <span>{t(labelKey)}</span>
            {id === "order" && cartCount > 0 ? <span className="absolute end-[23%] top-1.5 flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[9px] font-bold leading-4 text-white">{formatNumber(cartCount)}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
