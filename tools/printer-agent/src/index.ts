import { main } from "./agent";

main().catch((error: unknown) => {
  // Configuration problems are the common case; report them plainly and stop
  // rather than looping against a server that will keep refusing.
  console.error(
    `[printer-agent] ${error instanceof Error ? error.message : "Unknown startup error"}`,
  );
  process.exitCode = 1;
});
