import "server-only";

import { getServerEnvironment } from "@/lib/env/server";
import { redactLogValue, redactString } from "./redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}
export interface StructuredLogger {
  debug(event: string, message: string, context?: LogContext): void;
  info(event: string, message: string, context?: LogContext): void;
  warn(event: string, message: string, context?: LogContext): void;
  error(event: string, message: string, context?: LogContext): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeEvent(event: string): string {
  const normalized = event.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
  return normalized.slice(0, 96) || "application.event";
}

export function createLogger(component: string, minimumLevel?: LogLevel): StructuredLogger {
  const threshold = minimumLevel ?? getServerEnvironment().logLevel;

  function write(level: LogLevel, event: string, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[threshold]) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      component: normalizeEvent(component),
      event: normalizeEvent(event),
      message: redactString(message),
      ...(context ? { context: redactLogValue(context) } : {}),
    };
    const serialized = JSON.stringify(record);
    if (level === "error") console.error(serialized);
    else if (level === "warn") console.warn(serialized);
    else if (level === "debug") console.debug(serialized);
    else console.info(serialized);
  }

  return {
    debug: (event, message, context) => write("debug", event, message, context),
    info: (event, message, context) => write("info", event, message, context),
    warn: (event, message, context) => write("warn", event, message, context),
    error: (event, message, context) => write("error", event, message, context),
  };
}
