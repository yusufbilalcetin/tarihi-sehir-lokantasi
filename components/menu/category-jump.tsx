"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check, ChevronDown, Menu } from "lucide-react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import type { MenuViewCategory } from "@/lib/adapters/menu-view-model";
import { getMenuCategoryName } from "@/lib/i18n/menu-content";
import { cn } from "@/lib/utils";

/**
 * Where the guest is, and where else they could go.
 *
 * Two shapes were wrong before this one. First a rounded pill with a chevron —
 * the shape of a form control, saying the same word from soup to dessert. Then
 * a full bottom sheet, which is the right weight for a dish and far too much
 * for picking a section: it covered most of the screen, dimmed the menu, and
 * arrived from an edge that had nothing to do with the control that opened it.
 *
 * It is a menu anchored to its own trigger now. It grows from the right-hand
 * side of the bar — the part that names the current category — because that is
 * the thing the guest just touched. No backdrop, nothing dimmed, no layout
 * pushed down: choosing a section is a small navigation act and should cost the
 * screen nothing.
 *
 * The list still hides nothing. Every category section is on the page in the
 * restaurant's own order; this only shortens the journey between them.
 */

/**
 * Where the bar parks.
 *
 * On the QR menu it parks under the restaurant header, whose height is a shared
 * token rather than a number copied into two files. The public ordering page has
 * no header above it and passes `top-0`.
 */
const QR_MENU_STICKY_TOP = "top-[calc(env(safe-area-inset-top)+var(--menu-header-height))]";

/** The gap left between the sticky chrome and a heading it scrolled to. */
const HEADING_BREATHING_ROOM = 14;

/**
 * Past this, the browser's own smooth scroll stops being a transition and
 * becomes a journey — seconds of blurred dishes for a guest who asked to be
 * somewhere else. Beyond it, go straight there.
 */
const SMOOTH_SCROLL_LIMIT_PX = 2400;

export function CategoryJump({
  sections,
  stickyTopClass = QR_MENU_STICKY_TOP,
  renderItemActions,
}: {
  readonly sections: readonly { category: MenuViewCategory; products: readonly unknown[] }[];
  readonly stickyTopClass?: string;
  /**
   * Administrator-only controls at the end of each row — reordering and an
   * edit affordance. Absent on the public menu, which is what keeps this one
   * popover serving both without a second implementation of it.
   */
  readonly renderItemActions?: (
    category: MenuViewCategory,
    index: number,
    total: number,
  ) => ReactNode;
}) {
  const { language, t } = useMenuPreferences();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /**
   * The panel hangs off this, not off the whole row.
   *
   * The entire row is the trigger, because a thumb should not have to find the
   * right third of a bar. But the panel is anchored to the segment naming the
   * current category, so it opens from the words the guest was reading.
   */
  const anchorRef = useRef<HTMLSpanElement>(null);

  /** The bottom edge of the sticky chrome, in viewport coordinates. */
  const chromeBottom = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return 0;
    // `getComputedStyle().top` resolves the sticky offset — safe-area inset and
    // header token included — to real pixels, so this is correct on a notched
    // phone and on a laptop without one.
    const stickyTop = Number.parseFloat(getComputedStyle(bar).top) || 0;
    return stickyTop + bar.getBoundingClientRect().height;
  }, []);

  /**
   * Which category the guest is reading.
   *
   * One observer over the handful of category sections — never the sixty-one
   * dishes, and never a scroll listener. State is written only when the answer
   * changes, so scrolling inside a long category costs no renders at all.
   */
  useEffect(() => {
    if (sections.length < 2 || typeof IntersectionObserver === "undefined") return;
    const ids = sections.map((section) => section.category.id);

    const pickActive = () => {
      // The heading parks a breathing room below the chrome, so that gap is
      // part of "reached" — without it the bar names the previous category
      // while the guest is looking at the heading of the next one.
      const edge = chromeBottom() + HEADING_BREATHING_ROOM + 4;
      let current = ids[0];
      for (const id of ids) {
        const heading = document.getElementById(`menu-category-${id}`);
        if (!heading) continue;
        if (heading.getBoundingClientRect().top <= edge) current = id;
        else break;
      }
      setActiveId((previous) => (previous === current ? previous : current ?? null));
    };

    const observer = new IntersectionObserver(pickActive, {
      // A band from just under the chrome down to a fifth of the screen. Stated
      // as a percentage so a rotation does not need it rebuilt.
      rootMargin: `-${Math.round(chromeBottom())}px 0px -80% 0px`,
      threshold: 0,
    });
    // The whole section, not just its heading. A heading is a thin strip: a
    // jump of several thousand pixels teleports it clean through the band
    // without ever intersecting, so the observer never fires and the bar keeps
    // naming the category the guest left. Sections tile the page, so crossing
    // from one to the next always changes an intersection.
    for (const id of ids) {
      const section = document.querySelector(`[aria-labelledby="menu-category-${id}"]`);
      if (section) observer.observe(section);
    }
    pickActive();
    return () => observer.disconnect();
  }, [chromeBottom, sections]);

  // One category is not a menu to navigate.
  if (sections.length < 2) return null;

  const active = sections.find((section) => section.category.id === activeId) ?? sections[0];
  const activeName = getMenuCategoryName(active.category, language);

  function jumpTo(categoryId: string) {
    const heading = document.getElementById(`menu-category-${categoryId}`);
    if (!heading) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = Math.max(
      0,
      heading.getBoundingClientRect().top + window.scrollY - chromeBottom() - HEADING_BREATHING_ROOM,
    );
    const far = Math.abs(top - window.scrollY) > SMOOTH_SCROLL_LIMIT_PX;
    window.scrollTo({ top, behavior: reduced || far ? "auto" : "smooth" });
    // The guest just named where they are going, so the bar says so at once
    // rather than waiting for the scroll to cross an observer band.
    setActiveId(categoryId);

    // Acknowledge the arrival, once. The attribute takes itself off again so a
    // second visit to the same category still plays.
    if (!reduced) {
      heading.setAttribute("data-arrived", "true");
      heading.addEventListener("animationend", () => heading.removeAttribute("data-arrived"), {
        once: true,
      });
    }
  }

  return (
    <MenuPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <div
        ref={barRef}
        data-menu-category-bar="true"
        // Part of the header system rather than a control floating over it:
        // full bleed, one thin rule underneath, and an opaque surface so dishes
        // pass cleanly beneath without costing a blur on every scrolled frame.
        className={cn(
          "sticky z-[var(--z-sticky)] -mx-[var(--menu-gutter)] border-b border-border/50 bg-surface px-[var(--menu-gutter)]",
          stickyTopClass,
        )}
      >
        <MenuPrimitive.Trigger
          render={
            <button
              type="button"
              // Names itself and the answer it is showing, so the row reads as
              // one thing to a screen reader rather than two loose labels.
              aria-label={`${t("categories")}: ${activeName}`}
              className="motion-press flex h-[var(--menu-category-height)] w-full items-center gap-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          <Menu className="size-4 shrink-0 text-burgundy" strokeWidth={2} aria-hidden="true" />
          <span className="font-semibold text-text-primary">{t("categories")}</span>
          {/* The anchor. Opening tints it, and that tint is the whole visual
              link between the control and the panel — no speech-bubble arrow. */}
          <span
            ref={anchorRef}
            className={cn(
              "ms-auto flex min-w-0 items-center gap-1 transition-colors duration-[var(--motion-quick)] ease-[var(--ease-out)]",
              open ? "text-burgundy" : "text-text-secondary",
            )}
          >
            {/* Keyed on the category, so a change lifts and fades instead of
                snapping from one word to another. */}
            <span key={active.category.id} className="motion-action-label truncate font-medium">
              {activeName}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 opacity-70 transition-transform duration-[var(--motion-quick)] ease-[var(--ease-out)]",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </span>
        </MenuPrimitive.Trigger>
      </div>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={anchorRef}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[var(--z-popover)]"
        >
          <MenuPrimitive.Popup
            // `--transform-origin` is set by the positioner from side + align,
            // so aligned to the end of a bottom-side anchor it resolves to the
            // top right: the panel grows out of the words it belongs to.
            className={cn(
              "motion-popover motion-menu-popover origin-(--transform-origin) overflow-hidden rounded-2xl border border-border-subtle bg-popover py-1 text-popover-foreground shadow-[var(--shadow-floating)]",
              renderItemActions
                // Reorder controls need room and a 44px touch target each, so
                // the administrator's panel is wider than the guest's.
                ? "w-[min(22rem,calc(100vw-1.5rem))] min-w-[17rem]"
                : "w-[min(17rem,calc(100vw-1.5rem))] min-w-[14.5rem]",
            )}
          >
            {sections.map(({ category, products }, index) => {
              const name = getMenuCategoryName(category, language);
              const current = category.id === active.category.id;
              const actions = renderItemActions?.(category, index, sections.length);
              const row = (
                <MenuPrimitive.Item
                  key={category.id}
                  onClick={() => jumpTo(category.id)}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "motion-press flex w-full cursor-default items-center gap-2.5 px-3 text-start outline-none select-none data-highlighted:bg-accent/45",
                    actions ? "h-12 flex-1" : "h-12",
                  )}
                >
                  {/* A mark, not a filled pill: the current row is stated, not
                      highlighted. */}
                  <Check
                    className={cn("size-4 shrink-0 text-burgundy", !current && "opacity-0")}
                    strokeWidth={2.4}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-heading text-[15px] font-semibold",
                      current ? "text-burgundy" : "text-text-primary",
                    )}
                  >
                    {name}
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-text-muted">
                    {products.length}
                  </span>
                </MenuPrimitive.Item>
              );
              // The controls sit beside the row rather than inside it, so a tap
              // on "move up" never also jumps the page to that category.
              return actions ? (
                <div key={category.id} className="flex items-center pe-1.5">
                  {row}
                  {actions}
                </div>
              ) : (
                row
              );
            })}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
