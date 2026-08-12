"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type MotionDirection = "up" | "down";

export function MotionValue({
  value,
  numericValue,
  direction,
  delayMs = 0,
  className,
}: {
  value: string | number;
  numericValue?: number;
  direction?: MotionDirection;
  delayMs?: number;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(value);
  const [displayedNumeric, setDisplayedNumeric] = useState(numericValue);
  const [previousNumeric, setPreviousNumeric] = useState<number | undefined>(undefined);
  const [previous, setPrevious] = useState<string | number | null>(null);
  const [version, setVersion] = useState(0);

  if (value !== displayed) {
    setPrevious(displayed);
    setPreviousNumeric(displayedNumeric);
    setDisplayed(value);
    setDisplayedNumeric(numericValue);
    setVersion((current) => current + 1);
  }

  const resolvedDirection = direction
    ?? (numericValue !== undefined && previousNumeric !== undefined && numericValue < previousNumeric ? "down" : "up");
  const style = { "--motion-value-delay": `${delayMs}ms` } as CSSProperties;

  return (
    <span className={cn("motion-value", className)} style={style}>
      {previous !== null && previous !== displayed ? (
        <span key={`old-${version}`} aria-hidden="true" className="motion-value-old" data-direction={resolvedDirection}>{previous}</span>
      ) : null}
      <span key={`new-${version}`} className="motion-value-new" data-direction={resolvedDirection}>{displayed}</span>
    </span>
  );
}
