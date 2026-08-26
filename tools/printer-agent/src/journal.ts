import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * A small record of jobs this agent has already put on paper.
 *
 * It exists for one situation: the bytes reached the printer, and then the
 * acknowledgement was lost on the way back. When the server hands the same job
 * over again, the agent can complete it without printing a second ticket.
 *
 * This reduces duplicate paper; it does not eliminate it. A dumb ESC/POS
 * printer never confirms that anything was printed, so no software here can
 * honestly promise exactly-once physical output.
 */

const MAX_ENTRIES = 500;

export class PrintJournal {
  private printed: string[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(path.resolve(this.filePath), "utf8")) as unknown;
      this.printed = Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [];
    } catch {
      // A missing or corrupt journal is not a reason to refuse to print. The
      // worst case is one duplicate ticket after a crash, which is far better
      // than an agent that will not start.
      this.printed = [];
    }
  }

  has(jobId: string): boolean {
    return this.printed.includes(jobId);
  }

  record(jobId: string): void {
    if (this.has(jobId)) return;
    this.printed.push(jobId);
    // Bounded, so the file cannot grow without limit on a busy service.
    if (this.printed.length > MAX_ENTRIES) {
      this.printed = this.printed.slice(-MAX_ENTRIES);
    }
    this.persist();
  }

  private persist(): void {
    const target = path.resolve(this.filePath);
    const temporary = `${target}.tmp`;
    try {
      // Written aside and renamed, so a crash mid-write cannot leave a
      // half-written journal behind.
      writeFileSync(temporary, JSON.stringify(this.printed), "utf8");
      renameSync(temporary, target);
    } catch {
      // Persistence is an optimisation, not a correctness requirement.
    }
  }
}
