"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center surface-shadow">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><CircleAlert className="size-7" /></div>
        <h1 className="mt-5 font-heading text-2xl font-semibold">Bir şeyler yolunda gitmedi</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Ekran yüklenirken geçici bir sorun oluştu. Verileriniz değiştirilmedi.</p>
        <Button type="button" onClick={reset} className="mt-6 h-11 w-full rounded-xl"><RefreshCw className="size-4" /> Yeniden Dene</Button>
      </section>
    </main>
  );
}
