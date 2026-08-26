import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Agent configuration.
 *
 * The device map lives here, on the restaurant's own machine, because the LAN
 * layout is nobody else's business: the server records `kitchen-main` and this
 * file decides that it means `192.168.1.50:9100`. The bearer token is read from
 * the environment rather than the file, so a config copied for support never
 * carries a working credential.
 */

export interface TcpDevice {
  readonly transport: "tcp";
  readonly host: string;
  readonly port: number;
}

export type DeviceTarget = TcpDevice;

export interface AgentConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly pollIntervalMs: number;
  readonly idlePollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly claimLimit: number;
  readonly journalPath: string;
  readonly devices: Readonly<Record<string, DeviceTarget>>;
}

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentConfigError";
  }
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new AgentConfigError(`${name} must be a positive integer.`);
  }
  return value as number;
}

function parseDevices(raw: unknown): Record<string, DeviceTarget> {
  if (raw === null || typeof raw !== "object") {
    throw new AgentConfigError("devices must be an object of deviceKey to target.");
  }
  const devices: Record<string, DeviceTarget> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const target = value as Partial<TcpDevice>;
    if (target?.transport !== "tcp") {
      throw new AgentConfigError(`Device ${key}: only the "tcp" transport is supported.`);
    }
    if (typeof target.host !== "string" || target.host.trim() === "") {
      throw new AgentConfigError(`Device ${key}: host is required.`);
    }
    // A port is configuration, never an assumption: 9100 is only a common
    // default, and some printers do not use it.
    if (!Number.isInteger(target.port) || (target.port as number) < 1 || (target.port as number) > 65_535) {
      throw new AgentConfigError(`Device ${key}: port must be between 1 and 65535.`);
    }
    devices[key] = { transport: "tcp", host: target.host.trim(), port: target.port as number };
  }
  return devices;
}

export function loadAgentConfig(
  configPath = process.env.PRINTER_AGENT_CONFIG ?? "printer-agent.config.json",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentConfig {
  const token = environment.PRINTER_AGENT_TOKEN?.trim();
  if (!token) {
    throw new AgentConfigError(
      "PRINTER_AGENT_TOKEN is required. It is shown once when the agent is created or rotated.",
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path.resolve(configPath), "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new AgentConfigError(
      `Could not read ${configPath}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const baseUrl = String(raw.baseUrl ?? "").trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new AgentConfigError("baseUrl must be an absolute URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !loopback) {
    throw new AgentConfigError("baseUrl must use HTTPS outside loopback.");
  }

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    token,
    pollIntervalMs: positiveInteger(raw.pollIntervalMs, "pollIntervalMs", 3_000),
    // Idle polling is deliberately slower: a quiet restaurant must not produce
    // a request per printer per second all night.
    idlePollIntervalMs: positiveInteger(raw.idlePollIntervalMs, "idlePollIntervalMs", 10_000),
    heartbeatIntervalMs: positiveInteger(raw.heartbeatIntervalMs, "heartbeatIntervalMs", 30_000),
    claimLimit: positiveInteger(raw.claimLimit, "claimLimit", 5),
    journalPath: String(raw.journalPath ?? "printer-agent.journal.json"),
    devices: parseDevices(raw.devices ?? {}),
  };
}
