import net from "node:net";

import type { DeviceTarget } from "./config";

/**
 * Getting bytes to a printer.
 *
 * Network ESC/POS over plain TCP is the transport restaurants actually deploy,
 * and it is the only one implemented here. A USB path would need hardware to
 * verify honestly, so none is claimed.
 *
 * The failure codes below are the closed set the server understands. A socket
 * error never travels further than this file: the server receives a code and a
 * short summary, never a stack trace.
 */

export type TransportErrorCode =
  | "PRINTER_DEVICE_NOT_FOUND"
  | "PRINTER_CONNECTION_FAILED"
  | "PRINTER_WRITE_FAILED";

export class TransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface SendResult {
  readonly bytesWritten: number;
}

const CONNECT_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 15_000;

/**
 * Opens a socket, writes the payload, and closes it. Resolving means the bytes
 * left this machine — not that paper came out the other side.
 */
export function sendToDevice(
  device: DeviceTarget,
  payload: Uint8Array,
): Promise<SendResult> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (error: TransportError | null): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve({ bytesWritten: payload.byteLength });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("timeout", () => {
      finish(
        new TransportError(
          "PRINTER_CONNECTION_FAILED",
          `Timed out reaching ${device.host}:${device.port}.`,
        ),
      );
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      // ENOTFOUND and ECONNREFUSED are the everyday cases: a printer that is
      // switched off, or a device key pointing at nothing.
      const code: TransportErrorCode =
        error.code === "ENOTFOUND" ? "PRINTER_DEVICE_NOT_FOUND" : "PRINTER_CONNECTION_FAILED";
      finish(new TransportError(code, `${error.code ?? "SOCKET_ERROR"} at ${device.host}:${device.port}.`));
    });

    socket.connect(device.port, device.host, () => {
      socket.setTimeout(WRITE_TIMEOUT_MS);
      socket.write(payload, (writeError) => {
        if (writeError) {
          finish(new TransportError("PRINTER_WRITE_FAILED", "Write to printer failed."));
          return;
        }
        // `end` flushes and half-closes; the printer never replies.
        socket.end(() => finish(null));
      });
    });
  });
}
