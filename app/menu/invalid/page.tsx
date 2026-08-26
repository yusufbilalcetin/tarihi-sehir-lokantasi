import { connection } from "next/server";
import { QrCode } from "lucide-react";

import { BrandMark } from "@/components/shared/brand-mark";

export const metadata = {
  title: "Geçersiz QR | Tarihi Şehir Lokantası",
  description: "QR menü bağlantısı doğrulanamadı.",
};

// Rendered per request so the CSP nonce in the header matches the markup.
export default async function InvalidMenuQrPage() {
  await connection();
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-olive px-4 py-10 text-[#FFFDF8]">
      <section className="w-full max-w-md rounded-3xl border border-gold/25 bg-[#FFF9EF] p-7 text-center text-foreground shadow-2xl shadow-black/20 sm:p-9">
        <BrandMark className="mx-auto max-w-[17rem]" priority />
        <div className="mx-auto mt-7 flex size-14 items-center justify-center rounded-2xl border border-copper/30 bg-copper/10 text-burgundy">
          <QrCode className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-semibold">
          QR bağlantısı doğrulanamadı
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Bu QR kodu geçerli değil, kullanım dışı veya süresi dolmuş olabilir.
          Lütfen masanızdaki güncel QR kodunu yeniden okutun.
        </p>
      </section>
    </main>
  );
}
