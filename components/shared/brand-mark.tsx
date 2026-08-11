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
      <div className={cn("flex size-10 items-center justify-center rounded-xl border border-copper/35 bg-olive text-gold shadow-sm", className)} role="img" aria-label="Tarihi Şehir Lokantası">
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
      preload={priority}
      className={cn("h-auto w-full object-contain", className)}
    />
  );
}
