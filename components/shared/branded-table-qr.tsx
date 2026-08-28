"use client";

import { useMemo } from "react";

import { QR_CARD_BRAND } from "@/lib/qr/qr-card-layout";
import {
  QR_DARK_COLOR,
  QR_LIGHT_COLOR,
  QR_QUIET_ZONE_MODULES,
  buildQrMatrix,
  logoModuleSpan,
} from "@/lib/qr/qr-matrix";
import { cn } from "@/lib/utils";

/**
 * One table's menu code, drawn as vectors so it stays crisp from a phone
 * preview to a printed card.
 *
 * The whole grid is a single path rather than a rect per module: a code at
 * level H is around 1,600 modules, and 1,600 DOM nodes is a lot of browser for
 * a square. The brand sits on an ivory plate in the middle, inside the
 * correction budget the level buys — stacked over three lines, because the
 * house's name is the point and a lone initial says nothing.
 */
export function BrandedTableQr({
  menuUrl,
  className,
  title,
}: {
  readonly menuUrl: string;
  readonly className?: string;
  readonly title: string;
}) {
  const { path, canvasModules, logo } = useMemo(() => {
    const matrix = buildQrMatrix(menuUrl);
    const segments: string[] = [];
    for (let row = 0; row < matrix.moduleCount; row += 1) {
      for (let column = 0; column < matrix.moduleCount; column += 1) {
        if (!matrix.modules[row][column]) continue;
        segments.push(
          `M${column + QR_QUIET_ZONE_MODULES} ${row + QR_QUIET_ZONE_MODULES}h1v1h-1z`,
        );
      }
    }
    const span = logoModuleSpan(matrix.moduleCount);
    return {
      path: segments.join(""),
      canvasModules: matrix.canvasModules,
      logo: {
        span,
        origin: (matrix.canvasModules - span) / 2,
        center: matrix.canvasModules / 2,
        // The plate is small by design, so the three lines are stretched to a
        // fixed width rather than measured: every line lands the same length
        // whatever font actually resolves.
        textWidth: span * 0.74,
        lineHeight: span * 0.235,
      },
    };
  }, [menuUrl]);

  const lines = QR_CARD_BRAND.compact;

  return (
    <svg
      viewBox={`0 0 ${canvasModules} ${canvasModules}`}
      className={cn("block h-auto w-full max-w-full", className)}
      role="img"
      aria-label={title}
      // Sharp module edges at every size; smoothing is what makes small codes
      // fail to scan.
      shapeRendering="crispEdges"
    >
      <rect width={canvasModules} height={canvasModules} fill={QR_LIGHT_COLOR} />
      <path d={path} fill={QR_DARK_COLOR} />
      <rect
        x={logo.origin}
        y={logo.origin}
        width={logo.span}
        height={logo.span}
        rx={logo.span * 0.14}
        fill={QR_LIGHT_COLOR}
        stroke="#C29B5B"
        strokeWidth={logo.span * 0.05}
      />
      <g
        fill="#681F27"
        fontFamily="var(--font-heading)"
        fontWeight={600}
        fontSize={logo.lineHeight * 0.92}
        textAnchor="middle"
        shapeRendering="auto"
      >
        {lines.map((line, index) => (
          <text
            key={line}
            x={logo.center}
            y={logo.center + (index - (lines.length - 1) / 2) * logo.lineHeight}
            dominantBaseline="central"
            textLength={logo.textWidth}
            lengthAdjust="spacingAndGlyphs"
          >
            {line}
          </text>
        ))}
      </g>
    </svg>
  );
}
