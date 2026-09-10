"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { BrandMark } from "@/components/shared/brand-mark";
import { SoundControl } from "@/components/shared/sound-control";
import { LogoutButton } from "@/components/staff/logout-button";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";
import { getInitials } from "@/lib/format";
import type { StaffRealtimeStatus } from "@/lib/realtime/use-staff-realtime";
import { cn } from "@/lib/utils";

type OperationalTone = "blue" | "amber" | "burgundy" | "green" | "teal" | "neutral";

const METRIC_TONES: Readonly<Record<OperationalTone, string>> = {
  blue: "border-[#4D82C7]/20 bg-[#EAF3FF]/78 text-[#275A96]",
  amber: "border-[#D99A38]/22 bg-[#FFF4DE]/82 text-[#8A5817]",
  burgundy: "border-burgundy/20 bg-[#F9E9E8]/80 text-burgundy",
  green: "border-[#4E8A62]/20 bg-[#EAF5EC]/82 text-[#356846]",
  teal: "border-[#3B8586]/20 bg-[#E7F4F1]/82 text-[#2C6A6B]",
  neutral: "border-[#7A6B5D]/16 bg-white/62 text-[#59483A]",
};

/**
 * Shared chrome for the three operational products.
 *
 * It intentionally owns no navigation or permissions. Each role keeps its own
 * route guard and workflow; this only gives the screens one restaurant family,
 * one signed-in identity and one calm place for connection/sound controls.
 */
export function OperationalTopBar({
  title,
  homeHref,
  realtimeStatus,
  sound = false,
  end,
}: {
  readonly title: string;
  readonly homeHref: string;
  readonly realtimeStatus?: StaffRealtimeStatus;
  readonly sound?: boolean;
  readonly end?: ReactNode;
}) {
  const { name, role, restaurantName } = useStaffSession();
  const brand = restaurantName?.trim() || "Tarihi Şehir Lokantası";

  return (
    <header className="sticky top-0 z-30 border-b border-[#6B4A32]/10 bg-[#FFF9EF]/88 text-[#2D2018] shadow-[0_8px_24px_rgba(67,45,29,0.06)] backdrop-blur-xl supports-[backdrop-filter]:bg-[#FFF9EF]/76">
      <div className="mx-auto flex min-h-16 w-full max-w-[1600px] items-center gap-3 px-3 sm:px-6 lg:px-8">
        <Link
          href={homeHref}
          className="motion-press flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2"
          aria-label={`${brand} ${title} ana ekranı`}
        >
          <BrandMark compact className="size-9 shrink-0 rounded-xl border-[#A76B38]/28 bg-[#3D2A20] text-[#F1C477]" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold tracking-tight sm:text-[15px]">{title}</span>
            <span className="hidden truncate text-[11px] font-medium text-[#7B6A5C] sm:block">{brand}</span>
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2.5">
          {realtimeStatus ? <RealtimeStatus status={realtimeStatus} className="max-w-48" /> : null}
          {sound ? <SoundControl /> : null}
          {end}
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3D2A20] text-[11px] font-bold text-[#F1C477] xl:hidden"
            aria-label={`${name}, ${STAFF_ROLE_LABELS[role]}`}
            title={`${name} · ${STAFF_ROLE_LABELS[role]}`}
          >
            {getInitials(name)}
          </span>
          <div className="hidden items-center gap-2 rounded-xl border border-[#6B4A32]/10 bg-white/55 py-1.5 pe-2.5 ps-1.5 xl:flex">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#3D2A20] text-xs font-bold text-[#F1C477]" aria-hidden="true">
              {getInitials(name)}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block max-w-36 truncate text-xs font-bold">{name}</span>
              <span className="block max-w-36 truncate text-[11px] text-[#7B6A5C]">{STAFF_ROLE_LABELS[role]}</span>
            </span>
          </div>
          <LogoutButton className="shrink-0 text-[#6B5546] hover:bg-[#6B4A32]/8 hover:text-burgundy" />
        </div>
      </div>
    </header>
  );
}

/** A truthful at-a-glance number. Unknown and failed data never becomes zero. */
export function OperationalMetric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  ready = true,
  loading = false,
  onActivate,
  active = false,
  iconClassName,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly icon: LucideIcon;
  readonly tone?: OperationalTone;
  readonly ready?: boolean;
  readonly loading?: boolean;
  readonly onActivate?: () => void;
  readonly active?: boolean;
  readonly iconClassName?: string;
}) {
  const content = (
    <>
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-white/68 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_7px_16px_rgba(43,33,29,0.09)]", iconClassName)}>
        <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-bold uppercase tracking-[0.045em] opacity-70 sm:text-xs">{label}</span>
        <span className="mt-0.5 block text-xl font-extrabold leading-none tabular-nums tracking-tight sm:text-2xl">
          {ready ? value : "—"}
        </span>
        {!ready ? (
          <span className="sr-only">{loading ? "Yükleniyor" : "Bilgi alınamadı"}</span>
        ) : null}
      </span>
    </>
  );
  const className = cn(
    "flex min-h-[4.75rem] min-w-0 items-center gap-2.5 rounded-[20px] border px-3 py-2.5 text-left shadow-[0_10px_26px_rgba(73,48,31,0.055)] backdrop-blur-md supports-[backdrop-filter]:bg-opacity-75",
    METRIC_TONES[tone],
    active && "ring-2 ring-current ring-offset-2 ring-offset-[#F8F1E7]",
  );

  return onActivate ? (
    <button
      type="button"
      onClick={onActivate}
      aria-pressed={active}
      className={cn(
        className,
        "motion-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2",
      )}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export type OperationalHomeRole = "service" | "kitchen" | "cashier";

/**
 * The shared Home Screen canvas. It deliberately stops at atmosphere and
 * rhythm: every role supplies its own live facts, launchers and work surface.
 */
export function OperationalHome({
  role,
  children,
  className,
  as = "main",
}: {
  readonly role: OperationalHomeRole;
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "main" | "div";
}) {
  const Component = as;
  return (
    <Component
      data-operational-home={role}
      className={cn(
        "mx-auto min-h-[calc(100dvh-4rem)] w-full max-w-[1440px] px-3 pb-10 pt-4 sm:px-6 sm:pb-12 sm:pt-6 lg:px-8 lg:pt-8",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function OperationalHero({
  title,
  person,
  description,
  aside,
}: {
  readonly title: string;
  readonly person?: string;
  readonly description: string;
  readonly aside?: ReactNode;
}) {
  return (
    <header className="mb-4 flex min-w-0 items-end justify-between gap-4 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-[clamp(2.15rem,8vw,3.6rem)] font-semibold leading-[1.01] tracking-[-0.045em] text-[#2B211D]">
          {title}
        </h1>
        {person ? (
          <p className="mt-1 truncate text-[18px] font-semibold leading-6 text-[#44372F] sm:text-xl">
            {person}
          </p>
        ) : null}
        <p className="mt-1 text-[13px] font-medium text-[#6B5D53] sm:text-sm">{description}</p>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  );
}

export function OperationalSectionHeading({
  id,
  title,
  detail,
}: {
  readonly id: string;
  readonly title: string;
  readonly detail?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-w-0 items-end justify-between gap-3 sm:mb-4">
      <h2 id={id} className="text-lg font-semibold tracking-[-0.015em] text-[#2B211D] sm:text-xl">
        {title}
      </h2>
      {detail ? <div className="shrink-0 text-xs font-semibold text-[#706156]">{detail}</div> : null}
    </div>
  );
}

export function OperationalActionGrid({
  children,
  className,
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabel: string;
}) {
  return (
    <nav
      className={cn("grid grid-cols-4 gap-x-2 gap-y-3 sm:gap-x-4 sm:gap-y-4", className)}
      aria-label={ariaLabel}
    >
      {children}
    </nav>
  );
}

export function OperationalAction({
  label,
  icon: Icon,
  iconClassName,
  href,
  onClick,
  active = false,
  badge,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName: string;
  readonly href?: string;
  readonly onClick?: () => void;
  readonly active?: boolean;
  readonly badge?: ReactNode;
}) {
  const content = (
    <>
      <span
        className={cn(
          "relative flex size-14 shrink-0 items-center justify-center rounded-[18px] text-white shadow-[0_8px_18px_rgba(43,33,29,0.16),inset_0_1px_0_rgba(255,255,255,0.28)] transition-transform duration-150 group-hover:-translate-y-0.5 sm:size-[68px] sm:rounded-[21px] motion-reduce:transition-none",
          iconClassName,
          active && "ring-2 ring-[#6A2631] ring-offset-3 ring-offset-transparent",
        )}
      >
        <Icon className="size-7 sm:size-8" strokeWidth={1.9} aria-hidden="true" />
        {badge ? (
          <span className="absolute -end-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#681F25] px-1 text-[10px] font-extrabold leading-5 text-white ring-2 ring-[#F7F0E6]">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="max-w-full text-center text-[12px] font-semibold leading-4 text-[#2B211D] sm:text-sm">
        {label}
      </span>
    </>
  );
  const className =
    "motion-press group flex min-h-[84px] min-w-0 flex-col items-center justify-start gap-1.5 rounded-2xl px-0.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A3040] focus-visible:ring-offset-4 focus-visible:ring-offset-transparent sm:min-h-[108px] sm:gap-2 motion-reduce:transition-none";

  return href ? (
    <Link href={href} className={className} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onClick} aria-pressed={active}>
      {content}
    </button>
  );
}

export function OperationalMetricGrid({
  children,
  className,
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 lg:grid-cols-4", className)} aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function OperationalBackdrop({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-h-[100dvh] overflow-x-clip bg-[#F7F0E6] text-[#2D2018]",
        "before:pointer-events-none before:fixed before:inset-0 before:bg-[radial-gradient(circle_at_9%_5%,rgba(216,169,104,0.18),transparent_30%),radial-gradient(circle_at_90%_4%,rgba(55,128,128,0.12),transparent_28%),radial-gradient(circle_at_58%_100%,rgba(104,31,37,0.07),transparent_34%)]",
        className,
      )}
    >
      <div className="relative">{children}</div>
    </div>
  );
}
