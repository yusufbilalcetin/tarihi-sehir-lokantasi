import { BellRing, ClipboardList, ReceiptText, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

export type MenuTab = "menu" | "order" | "waiter" | "bill";

const items = [
  { id: "menu" as const, label: "Menü", icon: UtensilsCrossed },
  { id: "order" as const, label: "Siparişim", icon: ClipboardList },
  { id: "waiter" as const, label: "Garson", icon: BellRing },
  { id: "bill" as const, label: "Hesap", icon: ReceiptText },
];

export function BottomNavigation({ active, cartCount, onChange }: { active: MenuTab; cartCount: number; onChange: (tab: MenuTab) => void }) {
  return (
    <nav aria-label="Müşteri menü navigasyonu" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/96 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(37,33,29,0.1)] backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-xl grid-cols-4 px-2">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onChange(id)} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active === id ? "text-burgundy" : "text-muted-foreground hover:text-foreground")} aria-current={active === id ? "page" : undefined}>
            <Icon className="size-5" strokeWidth={active === id ? 2.2 : 1.7} />
            <span>{label}</span>
            {id === "order" && cartCount > 0 ? <span className="absolute right-[23%] top-1.5 flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[9px] font-bold leading-4 text-white">{cartCount}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
