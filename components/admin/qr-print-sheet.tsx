"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Hands finished cards to the printer and gets out of the way.
 *
 * The cards are already rendered to images, so printing is a matter of putting
 * them somewhere the print stylesheet can see alone — a node portalled
 * directly into `body`, with a flag that tells the stylesheet to hide the admin
 * panel around it. No second route, no popup window, and nothing on screen.
 */
export function QrPrintSheet({
  images,
  widthMm,
  heightMm,
  onDone,
}: {
  readonly images: readonly string[];
  /** The card's real printed size; the page is cut to it. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly onDone: () => void;
}) {
  useEffect(() => {
    if (images.length === 0) return;
    let cancelled = false;

    // `@page` takes no class or attribute, so the chosen paper size has to be
    // written as a rule and taken away again afterwards. The browser's own
    // margin setting stays the operator's to decide; this only states the size.
    const pageStyle = document.createElement("style");
    pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0 }`;
    document.head.append(pageStyle);

    const run = async () => {
      // Data URLs still decode asynchronously; printing before they do prints
      // empty boxes.
      await Promise.all(
        images.map(
          (source) =>
            new Promise<void>((resolve) => {
              const image = new Image();
              image.onload = () => resolve();
              image.onerror = () => resolve();
              image.src = source;
            }),
        ),
      );
      if (cancelled) return;
      document.body.dataset.qrPrint = "true";
      window.print();
      delete document.body.dataset.qrPrint;
      onDone();
    };

    void run();
    return () => {
      cancelled = true;
      pageStyle.remove();
      delete document.body.dataset.qrPrint;
    };
  }, [heightMm, images, onDone, widthMm]);

  // Only ever populated by a click, so there is no server render to guard.
  if (images.length === 0) return null;

  return createPortal(
    <div id="qr-print-root" aria-hidden="true">
      {images.map((source, index) => (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL card, already rendered at print resolution
        <img
          key={index}
          src={source}
          alt=""
          style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
        />
      ))}
    </div>,
    document.body,
  );
}
