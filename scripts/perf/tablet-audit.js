/**
 * Tablet acceptance probe — paste into the browser console on the tablet.
 *
 * The manual checklist mixes two kinds of question. "Is the table number
 * comfortable to read across a kitchen?" needs a person. "Is there horizontal
 * overflow?" does not — and a person eyeballing it will miss two pixels that a
 * measurement catches every time. This measures everything measurable and
 * prints it as the checklist, so the human judgement is spent only where it is
 * actually needed.
 *
 * It reads the page. It clicks nothing, submits nothing and changes no state,
 * so it is safe to run on any screen mid-flow.
 *
 * Usage: open the screen you want to check, paste this, read the output.
 */
(() => {
  const TOUCH_FLOOR = 44; // the product's --touch-target contract, in CSS px

  const viewport = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    orientation: matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape",
    maxTouchPoints: navigator.maxTouchPoints,
    breakpoints: {
      "max-width:1024": matchMedia("(max-width: 1024px)").matches,
      "max-width:820": matchMedia("(max-width: 820px)").matches,
      "min-width:768 (md)": matchMedia("(min-width: 768px)").matches,
      "min-width:1024 (lg)": matchMedia("(min-width: 1024px)").matches,
    },
  };

  const doc = document.documentElement;
  const horizontalOverflow = doc.scrollWidth - doc.clientWidth;

  // Anything wider than the viewport is what causes that overflow; naming the
  // culprits is the difference between "there is overflow" and a fix.
  const wideElements = [...document.querySelectorAll("*")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.right > window.innerWidth + 1)
    .slice(0, 6)
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 55),
      overhangPx: Math.round(r.right - window.innerWidth),
    }));

  const win = document.querySelector('[role="dialog"]');
  const windowFit = win
    ? (() => {
        const r = win.getBoundingClientRect();
        return {
          size: `${Math.round(r.width)}×${Math.round(r.height)}`,
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          insideViewport: r.top >= -2 && r.bottom <= window.innerHeight + 2 && r.left >= -2 && r.right <= window.innerWidth + 2,
          scrollRegions: win.querySelectorAll(".overflow-y-auto").length,
        };
      })()
    : null;

  /** Controls a person must be able to hit; excludes decorative and hidden. */
  const controls = [...document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden");

  const smallTargets = controls
    .filter(({ r }) => r.height < TOUCH_FLOOR)
    .map(({ el, r }) => ({
      label: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 32) || `<${el.tagName.toLowerCase()}>`,
      height: Math.round(r.height),
      width: Math.round(r.width),
    }));

  // A control scrolled or covered out of reach is worse than a small one: the
  // person cannot finish the task at all.
  const offscreen = controls
    .filter(({ r }) => r.bottom > window.innerHeight + 2 || r.right > window.innerWidth + 2 || r.left < -2)
    .map(({ el, r }) => ({
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 32) || `<${el.tagName.toLowerCase()}>`,
      position: `${Math.round(r.left)},${Math.round(r.top)}`,
    }));

  /** Money that has been visually truncated still reads as a smaller number. */
  const clippedMoney = [...document.querySelectorAll("*")]
    .filter((el) => el.children.length === 0 && /[₺]/.test(el.textContent || ""))
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => ({ text: (el.textContent || "").trim().slice(0, 24), visible: el.clientWidth, needed: el.scrollWidth }));

  // Kitchen only: how much room each of the three stage columns actually got.
  const board = document.querySelector('[aria-label="Mutfak sipariş panosu"] > div');
  const kitchenColumns = board
    ? [...board.children].map((c) => Math.round(c.getBoundingClientRect().width))
    : null;

  const verdict = (ok) => (ok ? "PASS" : "FAIL");
  const lines = [
    "==================== TABLET AUDIT ====================",
    `URL                 ${location.pathname}`,
    `innerWidth          ${viewport.innerWidth}`,
    `innerHeight         ${viewport.innerHeight}`,
    `orientation         ${viewport.orientation}`,
    `devicePixelRatio    ${viewport.devicePixelRatio}`,
    `maxTouchPoints      ${viewport.maxTouchPoints}${viewport.maxTouchPoints > 0 ? "  (touch device)" : "  (no touch)"}`,
    `breakpoints         ${JSON.stringify(viewport.breakpoints)}`,
    "------------------------------------------------------",
    `horizontal overflow ${horizontalOverflow}px  ->  ${verdict(horizontalOverflow <= 0)}`,
    `window fits view    ${windowFit ? `${windowFit.size} top=${windowFit.top} bottom=${windowFit.bottom} -> ${verdict(windowFit.insideViewport)}` : "(no module window on this screen)"}`,
    `scroll regions      ${windowFit ? `${windowFit.scrollRegions} -> ${verdict(windowFit.scrollRegions <= 1)}` : "n/a"}`,
    `controls < ${TOUCH_FLOOR}px      ${smallTargets.length}  ->  ${verdict(smallTargets.length === 0)}`,
    `controls offscreen  ${offscreen.length}  ->  ${verdict(offscreen.length === 0)}`,
    `money clipped       ${clippedMoney.length}  ->  ${verdict(clippedMoney.length === 0)}`,
    kitchenColumns ? `kitchen columns     ${kitchenColumns.join(" / ")} px` : null,
    "======================================================",
  ].filter(Boolean);

  console.log(lines.join("\n"));
  if (wideElements.length) console.table(wideElements);
  if (smallTargets.length) console.table(smallTargets);
  if (offscreen.length) console.table(offscreen);
  if (clippedMoney.length) console.table(clippedMoney);

  return {
    viewport,
    horizontalOverflow,
    wideElements,
    windowFit,
    smallTargets,
    offscreen,
    clippedMoney,
    kitchenColumns,
    allMechanicalChecksPass:
      horizontalOverflow <= 0 &&
      (!windowFit || windowFit.insideViewport) &&
      smallTargets.length === 0 &&
      offscreen.length === 0 &&
      clippedMoney.length === 0,
  };
})();
