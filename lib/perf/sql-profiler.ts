import "server-only";

/**
 * Phase 32 profiling instrumentation. Opt-in, and inert in a production
 * deployment: it exists to tell "SQL is slow" apart from "the round trip is
 * slow" while measuring, not to run permanently.
 *
 * Only the statement *shape* is emitted — never parameter values, never the
 * connection string — so no PII or secret can reach the log through this path.
 * Send timestamps are enough to separate sequential round trips (~1 RTT apart)
 * from pipelined ones (same millisecond).
 */
export function sqlProfilingEnabled(): boolean {
  return process.env.PERF_PROFILE === "1" && process.env.VERCEL_ENV !== "production";
}

export function sqlDebugHook(): (
  connection: number,
  query: string,
  parameters: unknown[],
) => void {
  return (connection, query, parameters) => {
    const shape = query.replace(/\s+/g, " ").trim().slice(0, 140);
    process.stdout.write(
      `[SQLPERF]\t${process.hrtime.bigint()}\t${connection}\t${parameters.length}\t${shape}\n`,
    );
  };
}
