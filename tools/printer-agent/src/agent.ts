import { loadAgentConfig, type AgentConfig } from "./config";
import { PrintJournal } from "./journal";
import { TransportError, sendToDevice } from "./transport";

/**
 * The agent loop.
 *
 * Outbound only: heartbeat, claim, deliver, report. It never listens on a port,
 * never holds a database credential, and never builds printer commands — the
 * server sends rendered bytes and this process forwards them.
 */

export interface ClaimedJob {
  readonly jobId: string;
  readonly deviceKey: string;
  readonly printerName: string;
  readonly copies: number;
  readonly documentType: string;
  readonly payloadVersion: number;
  readonly escposBase64: string;
  readonly attemptNumber: number;
  readonly leaseUntilIso: string;
}

export const AGENT_SOFTWARE_VERSION = "8c.1";
/** The payload shapes this build knows how to send. */
const SUPPORTED_PAYLOAD_VERSIONS = new Set([1]);

export interface AgentLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/** The token never appears in a log line, in success or failure. */
export const consoleLogger: AgentLogger = {
  info: (message, context) => console.info(`[printer-agent] ${message}`, context ?? ""),
  warn: (message, context) => console.warn(`[printer-agent] ${message}`, context ?? ""),
  error: (message, context) => console.error(`[printer-agent] ${message}`, context ?? ""),
};

export class PrinterAgent {
  private readonly journal: PrintJournal;
  private running = false;

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: AgentLogger = consoleLogger,
  ) {
    this.journal = new PrintJournal(config.journalPath);
  }

  private async call<TResult>(
    path: string,
    body: unknown,
  ): Promise<{ ok: true; data: TResult } | { ok: false; status: number }> {
    const response = await fetch(new URL(path, this.config.baseUrl), {
      method: "POST",
      headers: {
        // The agent's own credential; never a database or service-role secret.
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = (await response.json()) as { data?: TResult };
    return { ok: true, data: payload.data as TResult };
  }

  async heartbeat(): Promise<boolean> {
    const result = await this.call("/api/internal/printer-agent/heartbeat", {
      softwareVersion: AGENT_SOFTWARE_VERSION,
    });
    if (!result.ok) {
      this.logger.warn("heartbeat rejected", { status: result.status });
      return false;
    }
    return true;
  }

  /** Returns how many jobs were handled, so the caller can pace its polling. */
  async processOnce(): Promise<number> {
    const claimed = await this.call<{ jobs: ClaimedJob[] }>(
      "/api/internal/printer-agent/claim",
      { limit: this.config.claimLimit },
    );
    if (!claimed.ok) {
      this.logger.warn("claim rejected", { status: claimed.status });
      return 0;
    }

    const jobs = claimed.data?.jobs ?? [];
    for (const job of jobs) await this.deliver(job);
    return jobs.length;
  }

  private async deliver(job: ClaimedJob): Promise<void> {
    if (!SUPPORTED_PAYLOAD_VERSIONS.has(job.payloadVersion)) {
      // A document from a newer server is refused rather than half-printed.
      await this.reportFailure(job, "UNSUPPORTED_PRINT_PAYLOAD", "Unsupported payload version.");
      return;
    }

    // Already on paper: the acknowledgement was lost, not the ticket.
    if (this.journal.has(job.jobId)) {
      this.logger.info("job already printed; acknowledging without reprinting", {
        jobId: job.jobId,
      });
      await this.call("/api/internal/printer-agent/complete", { jobId: job.jobId });
      return;
    }

    const device = this.config.devices[job.deviceKey];
    if (!device) {
      await this.reportFailure(
        job,
        "PRINTER_DEVICE_NOT_FOUND",
        `No local mapping for device key ${job.deviceKey}.`,
      );
      return;
    }

    const payload = Buffer.from(job.escposBase64, "base64");
    try {
      let bytesWritten = 0;
      for (let copy = 0; copy < Math.max(1, job.copies); copy += 1) {
        const result = await sendToDevice(device, payload);
        bytesWritten += result.bytesWritten;
      }
      // Journalled before acknowledging: if the acknowledgement is lost, the
      // next delivery of this job finds it here.
      this.journal.record(job.jobId);
      await this.call("/api/internal/printer-agent/complete", {
        jobId: job.jobId,
        bytesWritten,
      });
      this.logger.info("job printed", { jobId: job.jobId, printer: job.printerName });
    } catch (error) {
      const transport =
        error instanceof TransportError
          ? error
          : new TransportError("PRINTER_WRITE_FAILED", "Delivery failed.");
      await this.reportFailure(job, transport.code, transport.message);
    }
  }

  private async reportFailure(
    job: ClaimedJob,
    errorCode: string,
    errorSummary: string,
  ): Promise<void> {
    this.logger.warn("job failed", { jobId: job.jobId, errorCode });
    await this.call("/api/internal/printer-agent/fail", {
      jobId: job.jobId,
      errorCode,
      // Already a short, safe sentence; no stack trace leaves this process.
      errorSummary: errorSummary.slice(0, 300),
    });
  }

  /**
   * Polls until stopped, slowing down when there is nothing to do so a quiet
   * night does not generate a request per second.
   */
  async run(signal?: AbortSignal): Promise<void> {
    this.running = true;
    let lastHeartbeat = 0;

    while (this.running && !signal?.aborted) {
      const now = Date.now();
      if (now - lastHeartbeat >= this.config.heartbeatIntervalMs) {
        await this.heartbeat().catch(() => false);
        lastHeartbeat = now;
      }

      const handled = await this.processOnce().catch((error: unknown) => {
        this.logger.error("poll failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return 0;
      });

      const delay = handled > 0 ? this.config.pollIntervalMs : this.config.idlePollIntervalMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  stop(): void {
    this.running = false;
  }
}

export async function main(): Promise<void> {
  const config = loadAgentConfig();
  const agent = new PrinterAgent(config);
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      agent.stop();
      controller.abort();
    });
  }
  consoleLogger.info("starting", {
    baseUrl: config.baseUrl,
    devices: Object.keys(config.devices),
  });
  await agent.run(controller.signal);
}
