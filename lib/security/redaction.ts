const REDACTED = "[REDACTED]";
const CIRCULAR = "[CIRCULAR]";
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;

// Deliberately broad: over-redaction is preferable to leaking a camelCase key
// such as rawToken, databaseUrl, customerSession, or serviceRoleKey.
const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|passwd|passphrase|pin|secret|session|token|api.?key|service.?role|private.?key|database.?url|qr)/i;

const STRING_PATTERNS: readonly [RegExp, string][] = [
  [/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`],
  [/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+)\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED],
  [/\bv1\.[A-Za-z0-9_-]{20,900}\.[A-Za-z0-9_-]{43}\b/g, REDACTED],
  [/(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?=$|[^A-Za-z0-9_-])/g, `$1${REDACTED}`],
  [/([?&](?:token|secret|key|code|pin|password)=)[^&#\s]*/gi, `$1${REDACTED}`],
  [/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`],
];

export function redactString(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of STRING_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

function redactInternal(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(process.env.NODE_ENV === "development" && value.stack
        ? { stack: redactString(value.stack) }
        : {}),
    };
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactString(value.toString());
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactInternal(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactInternal(nestedValue, depth + 1, seen);
  }
  return output;
}

export function redactLogValue(value: unknown): unknown {
  return redactInternal(value, 0, new WeakSet());
}
