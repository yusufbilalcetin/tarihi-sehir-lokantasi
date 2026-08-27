import { connection } from "next/server";

import { BrandMark } from "@/components/shared/brand-mark";
import { PrototypePortals } from "@/components/shared/prototype-portals";

// Rendered per request so the framework's inline scripts carry the same CSP
// nonce as the response header; a prerendered shell would be blocked instead.
export default async function Home() {
  await connection();
  return (
    <main className="flex min-h-[100dvh] flex-col justify-center bg-olive px-4 py-8 text-[#FFFDF8] sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-2xl">
          <BrandMark priority className="max-w-xl" />
          <p className="mt-5 max-w-lg text-sm leading-6 text-[#F5EBDD]/70">
            Tam frontend prototip. Müşteri ve operasyon ekranlarının tamamına buradan
            ulaşabilirsiniz.
          </p>
        </div>
        <PrototypePortals />
      </div>
    </main>
  );
}
