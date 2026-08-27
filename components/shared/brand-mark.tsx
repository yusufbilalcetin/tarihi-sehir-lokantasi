import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  compact?: boolean;
  className?: string;
  priority?: boolean;
}

export function BrandMark({ compact = false, className, priority = false }: BrandMarkProps) {
  if (compact) {
    return (
      <div className={cn("flex size-10 items-center justify-center rounded-md border border-gold/45 bg-sidebar text-gold shadow-[0_1px_3px_rgba(45,32,24,0.18)]", className)} role="img" aria-label="Tarihi Şehir Lokantası">
        <span className="font-heading text-lg font-semibold">Ş</span>
      </div>
    );
  }

  return (
    <Image
      src="/images/brand/wordmark-transparent.png"
      alt="Tarihi Şehir Lokantası"
      width={2172}
      height={724}
      // Without this Next sizes the srcset from the intrinsic 2172px and ships a
      // 3840px variant to a wordmark that is never drawn wider than ~576px.
      sizes="(max-width: 640px) 100vw, 576px"
      preload={priority}
      className={cn("h-auto w-full object-contain", className)}
    />
  );
}
