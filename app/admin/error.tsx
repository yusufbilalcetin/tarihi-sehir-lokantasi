"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[55dvh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border bg-card p-7 text-center shadow-[0_14px_40px_rgba(74,40,40,0.06)]">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="mt-4 font-heading text-2xl font-semibold">Bu bölüm açılamadı</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Geçici bir arayüz hatası oluştu. Sayfayı yeniden deneyebilirsiniz.</p>
        <Button className="mt-5 h-10" onClick={reset}>
          <RotateCcw className="size-4" /> Yeniden Dene
        </Button>
      </div>
    </div>
  );
}
