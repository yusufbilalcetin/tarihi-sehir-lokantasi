"use client";

import { QrCode } from "lucide-react";

import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";

/**
 * Shared full-screen state for the customer menu. It mirrors the /menu/invalid
 * card so an expired session or an unavailable menu never drops the guest onto
 * a raw error page.
 */
export function MenuStateCard({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-olive px-4 py-10 text-[#FFFDF8]">
      <section
        role="alert"
        className="w-full max-w-md rounded-3xl border border-gold/25 bg-[#FFF9EF] p-7 text-center text-foreground shadow-2xl shadow-black/20 sm:p-9"
      >
        <BrandMark className="mx-auto max-w-[17rem]" priority />
        <div className="mx-auto mt-7 flex size-14 items-center justify-center rounded-2xl border border-copper/30 bg-copper/10 text-burgundy">
          <QrCode className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <Button type="button" onClick={onAction} className="mt-6 h-12 w-full rounded-xl text-sm font-bold">
            {actionLabel}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
