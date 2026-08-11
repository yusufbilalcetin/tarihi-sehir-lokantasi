import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center surface-shadow">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-burgundy"><MapPinOff className="size-7" /></div>
        <p className="mt-5 text-xs font-bold tracking-widest text-copper">404</p>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Bu ekran bulunamadı</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Bağlantı değişmiş veya demo route’u kaldırılmış olabilir.</p>
        <Button nativeButton={false} render={<Link href="/" />} className="mt-6 h-11 w-full rounded-xl"><ArrowLeft className="size-4" /> Portal Seçimine Dön</Button>
      </section>
    </main>
  );
}
