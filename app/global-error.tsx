"use client";

import { useEffect } from "react";
import { CircleAlert, House, RefreshCw } from "lucide-react";

import "./globals.css";

/**
 * Replaces the root layout when rendering it fails, so it must supply its own
 * <html>/<body> and cannot rely on the fonts or providers the layout mounts.
 * `app/error.tsx` still handles every failure below the root — this is the
 * last resort, not a replacement for it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only safe correlation handle: Next.js logs the real
    // server error under it and never sends the message or stack to the client.
    console.error(
      JSON.stringify({
        level: "error",
        component: "app.global_error",
        event: "root_render_failed",
        digest: error.digest ?? null,
      }),
    );
  }, [error.digest]);

  return (
    <html lang="tr">
      <body className="min-h-full text-foreground">
        <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
          <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <CircleAlert className="size-7" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold">Uygulama açılamadı</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Beklenmeyen bir sorun oluştu. Siparişleriniz ve ödemeleriniz etkilenmedi.
            </p>
            {error.digest ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Destek kodu: <span className="font-mono">{error.digest}</span>
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground"
              >
                <RefreshCw className="size-4" /> Yeniden Dene
              </button>
              {/* A hard navigation on purpose: the client router lives inside the
                  root layout that just failed to render, so <Link> would try to
                  reuse the very tree this boundary replaced. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium"
              >
                <House className="size-4" /> Ana Sayfa
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
