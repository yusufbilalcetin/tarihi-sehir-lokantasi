import Link from "next/link";
import { ArrowRight, ChefHat, CookingPot, LayoutDashboard, ScanLine, WalletCards } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";

const portals = [
  { href: "/menu/demo-table", title: "Müşteri QR Menü", description: "Masa 7 demo menüsü", icon: ScanLine },
  { href: "/staff/login", title: "Garson Paneli", description: "Personel kodu: 1042", icon: ChefHat },
  { href: "/kitchen", title: "Mutfak Ekranı", description: "Canlı sipariş akışı", icon: CookingPot },
  { href: "/cashier", title: "Kasa Paneli", description: "Açık masa ve ödeme", icon: WalletCards },
  { href: "/admin/dashboard", title: "Yönetici Paneli", description: "Raporlar ve yönetim", icon: LayoutDashboard },
];

export default function Home() {
  return (
    <main className="min-h-[100dvh] bg-olive px-4 py-8 text-[#FFFDF8] sm:px-6 lg:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <BrandMark priority className="max-w-xl" />
          <p className="mt-5 max-w-lg text-sm leading-6 text-[#F5EBDD]/70">Tam frontend prototip. Müşteri ve operasyon ekranlarının tamamına buradan ulaşabilirsiniz.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {portals.map(({ href, title, description, icon: Icon }) => (
            <Link key={href} href={href} className="group flex min-h-44 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.055] p-5 transition-colors hover:border-copper/60 hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
              <Icon className="size-6 text-copper" strokeWidth={1.6} />
              <div>
                <h2 className="font-heading text-xl font-semibold">{title}</h2>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#F5EBDD]/60">
                  <span>{description}</span><ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
