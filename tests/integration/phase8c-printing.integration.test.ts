import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { generateAgentToken } from "../../lib/security/printer-agent-token";
import { generateQrToken } from "../../lib/security/qr-token";
import { DataMaintenanceService } from "../../lib/services/data-maintenance-service";
import { PrintDocumentService } from "../../lib/services/print-document-service";
import { PrintService } from "../../lib/services/print-service";
import { enqueueKitchenTickets } from "../../lib/services/kitchen-print";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";
import { sendToDevice } from "../../tools/printer-agent/src/transport";

/**
 * Phase 8C — the print queue on real PostgreSQL, and real bytes over a real
 * socket.
 *
 * The two properties worth proving here cannot be proven anywhere else: that
 * two workers racing for the same job produce exactly one delivery, and that
 * a printer being switched off never touches an order, a payment or a shift.
 *
 * A mock TCP printer stands in for the hardware. It proves the transport and
 * the bytes; it cannot prove that paper came out, and nothing here claims it.
 */

const PREFIX = "PHASE8C_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
const PEPPER = process.env.PRINTER_AGENT_TOKEN_PEPPER ?? "";

if (!readiness.ready || PEPPER.length < 32) {
  test("Phase 8C printing integration", {
    skip: readiness.ready
      ? "PRINTER_AGENT_TOKEN_PEPPER (32+ bytes) is required for the printing suite."
      : (readiness as { reason: string }).reason,
  }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let printing: PrintService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  /** A stand-in for the thermal printer, so the transport is genuinely exercised. */
  let mockPrinter: net.Server;
  let mockPort = 0;
  const received: Buffer[] = [];

  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    grillCategory: randomUUID(),
    drinkCategory: randomUUID(),
    kebap: randomUUID(),
    cola: randomUUID(),
    cay: randomUUID(),
    table: randomUUID(),
    waiter: randomUUID(),
    manager: randomUUID(),
    agent: randomUUID(),
    foreignAgent: randomUUID(),
    kitchenPrinter: randomUUID(),
    barPrinter: randomUUID(),
    receiptPrinter: randomUUID(),
    foreignPrinter: randomUUID(),
  };
  let sequence = 93000;

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const manager = (): RestaurantPrincipal => ({
    userId: ids.manager,
    restaurantId: ids.restaurant,
    role: "MANAGER",
    isActive: true,
  });
  const agent = () => ({ id: ids.agent, restaurantId: ids.restaurant });
  const foreignAgent = () => ({ id: ids.foreignAgent, restaurantId: ids.foreignRestaurant });

  async function code(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
      return "OK";
    } catch (error) {
      return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
    }
  }

  async function newOrder(): Promise<string> {
    const orderId = randomUUID();
    sequence += 1;
    await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
        subtotal, total, created_by_type, created_by_user_id, status) values
      (${orderId}, ${ids.restaurant}, ${ids.table}, ${sequence}, ${`${PREFIX}${sequence}`},
       '250.00', '250.00', 'STAFF', ${ids.waiter}, 'CONFIRMED')`;
    await sql`insert into order_items (id, restaurant_id, order_id, product_id,
        product_name_snapshot, unit_price, quantity, line_total, status, sort_order) values
      (${randomUUID()}, ${ids.restaurant}, ${orderId}, ${ids.kebap}, ${`${PREFIX}Kuzu Şiş`},
       '150.00', 1, '150.00', 'PENDING', 0),
      (${randomUUID()}, ${ids.restaurant}, ${orderId}, ${ids.cola}, ${`${PREFIX}Kola`},
       '100.00', 1, '100.00', 'PENDING', 1)`;
    return orderId;
  }

  async function jobsFor(orderId: string) {
    return sql`
      select id, printer_id, document_type::text as document_type, status::text as status,
        dedupe_key, payload_snapshot, reprint_of_job_id, reprint_reason, attempt_count
      from print_jobs where restaurant_id = ${ids.restaurant} and source_id = ${orderId}
      order by created_at, id`;
  }

  describe("Phase 8C printing queue and transport", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 8 });
      db = connection.db;
      sql = connection.client;
      printing = new PrintService(db);

      mockPrinter = net.createServer((socket) => {
        socket.on("data", (chunk) => received.push(chunk));
      });
      await new Promise<void>((resolve) => mockPrinter.listen(0, "127.0.0.1", resolve));
      mockPort = (mockPrinter.address() as net.AddressInfo).port;

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase8c-a-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Tenant B`}, ${`phase8c-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.waiter}, ${ids.restaurant}, ${`${PREFIX}Garson`}, ${`p8c-${run}-w`}, 'WAITER', true),
        (${ids.manager}, ${ids.restaurant}, ${`${PREFIX}Mudur`}, ${`p8c-${run}-m`}, 'MANAGER', true)`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.grillCategory}, ${ids.restaurant}, ${`${PREFIX}Izgara`}, ${`p8c-izg-${run}`}),
        (${ids.drinkCategory}, ${ids.restaurant}, ${`${PREFIX}Icecek`}, ${`p8c-ice-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.kebap}, ${ids.restaurant}, ${ids.grillCategory}, ${`${PREFIX}Kuzu Şiş`}, ${`p8c-kuzu-${run}`}, '150.00'),
        (${ids.cola}, ${ids.restaurant}, ${ids.drinkCategory}, ${`${PREFIX}Kola`}, ${`p8c-kola-${run}`}, '100.00'),
        (${ids.cay}, ${ids.restaurant}, ${ids.drinkCategory}, ${`${PREFIX}Çay`}, ${`p8c-cay-${run}`}, '20.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 9301, ${generateQrToken(randomBytes(32)).tokenHash})`;

      // Two agents, so cross-tenant claiming can be tested for real.
      const token = generateAgentToken(PEPPER);
      const foreignToken = generateAgentToken(PEPPER);
      await sql`insert into printer_agents (id, restaurant_id, name, token_hash, token_version) values
        (${ids.agent}, ${ids.restaurant}, ${`${PREFIX}Salon`}, ${token.tokenHash}, 1),
        (${ids.foreignAgent}, ${ids.foreignRestaurant}, ${`${PREFIX}B Salon`}, ${foreignToken.tokenHash}, 1)`;
      await sql`insert into restaurant_printers (id, restaurant_id, printer_agent_id, name, code,
          station_type, device_key, characters_per_line, encoding, auto_cut) values
        (${ids.kitchenPrinter}, ${ids.restaurant}, ${ids.agent}, ${`${PREFIX}Mutfak`},
         ${`P8CK${run.slice(0, 5).toUpperCase()}`}, 'KITCHEN', 'kitchen-main', 48, 'CP857', true),
        (${ids.barPrinter}, ${ids.restaurant}, ${ids.agent}, ${`${PREFIX}Bar`},
         ${`P8CB${run.slice(0, 5).toUpperCase()}`}, 'BAR', 'bar-main', 32, 'CP857', false),
        (${ids.receiptPrinter}, ${ids.restaurant}, ${ids.agent}, ${`${PREFIX}Kasa`},
         ${`P8CR${run.slice(0, 5).toUpperCase()}`}, 'RECEIPT', 'receipt-main', 48, 'CP1254', true),
        (${ids.foreignPrinter}, ${ids.foreignRestaurant}, ${ids.foreignAgent}, ${`${PREFIX}B Mutfak`},
         ${`P8CF${run.slice(0, 5).toUpperCase()}`}, 'KITCHEN', 'kitchen-main', 48, 'CP857', true)`;
      // Kitchen default, plus a drinks route to the bar.
      await sql`insert into printer_routes (restaurant_id, document_type, category_id, printer_id, copies) values
        (${ids.restaurant}, 'KITCHEN_ORDER', null, ${ids.kitchenPrinter}, 1),
        (${ids.restaurant}, 'KITCHEN_ORDER', ${ids.drinkCategory}, ${ids.barPrinter}, 1),
        (${ids.restaurant}, 'KITCHEN_CANCEL', null, ${ids.kitchenPrinter}, 1),
        (${ids.restaurant}, 'CUSTOMER_BILL', null, ${ids.receiptPrinter}, 1),
        (${ids.restaurant}, 'PAYMENT_RECEIPT', null, ${ids.receiptPrinter}, 1),
        (${ids.restaurant}, 'Z_REPORT', null, ${ids.receiptPrinter}, 1)`;
    });

    after(async () => {
      try {
        const order = [
          "print_job_attempts", "print_jobs", "printer_routes", "restaurant_printers",
          "printer_agents", "cash_drawer_movements", "payment_refunds", "payments",
          "order_check_items", "order_checks", "order_events", "audit_logs", "outbox_events",
          "idempotency_keys", "waiter_calls", "kitchen_tickets", "order_items", "orders",
          "cashier_shifts", "cash_registers", "restaurant_tables", "products", "categories",
          "restaurant_settings", "staff_profiles", "restaurants",
        ];
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of order) {
            const column = table === "restaurants" ? "id" : "restaurant_id";
            await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [tenant]);
          }
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      await new Promise<void>((resolve) => mockPrinter.close(() => resolve()));
      if (cleanupErrors.length > 0) {
        console.error("PHASE8C FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8c assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------- routing
    test("a mixed order becomes one ticket per station, each with its own lines", async () => {
      const orderId = await newOrder();
      const outcome = await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      check(outcome.created === 2, `two tickets (got ${outcome.created})`);
      check(outcome.unrouted === 0, "every line routed");

      const jobs = await jobsFor(orderId);
      const kitchen = jobs.find((job) => job.printer_id === ids.kitchenPrinter);
      const bar = jobs.find((job) => job.printer_id === ids.barPrinter);
      check(Boolean(kitchen && bar), "one ticket to the kitchen and one to the bar");

      const kitchenLines = (kitchen!.payload_snapshot as { lines: { productName: string }[] }).lines;
      const barLines = (bar!.payload_snapshot as { lines: { productName: string }[] }).lines;
      check(
        kitchenLines.length === 1 && kitchenLines[0].productName === `${PREFIX}Kuzu Şiş`,
        `the grill sees only the kebab (got ${JSON.stringify(kitchenLines)})`,
      );
      check(
        barLines.length === 1 && barLines[0].productName === `${PREFIX}Kola`,
        `the bar sees only the drink (got ${JSON.stringify(barLines)})`,
      );
      check(
        (kitchen!.payload_snapshot as { isAddition: boolean }).isAddition === false,
        "the first round is not marked as an addition",
      );
      check(jobs.every((job) => job.status === "PENDING"), "both wait for the agent");
    });

    test("a repeated confirmation cannot produce a second original ticket", async () => {
      const orderId = await newOrder();
      const request = {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW" as const,
        occurrence: "confirm",
      };
      // Two deliveries of the same event, genuinely in parallel.
      const [first, second] = await Promise.all([
        enqueueKitchenTickets(db, request),
        enqueueKitchenTickets(db, request),
      ]);
      check(
        first.created + second.created === 2,
        `two tickets in total, not four (got ${first.created} + ${second.created})`,
      );
      const jobs = await jobsFor(orderId);
      check(jobs.length === 2, `exactly one ticket per station (got ${jobs.length})`);
      check(
        new Set(jobs.map((job) => job.dedupe_key)).size === 2,
        "each ticket carries its own deterministic key",
      );
    });

    test("a late addition prints only what is new", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "ADDITION",
        occurrence: "add:abc",
        lines: [
          { productId: ids.cay, productName: `${PREFIX}Çay`, quantity: 1, note: null },
        ],
      });

      const jobs = await jobsFor(orderId);
      const addition = jobs.find(
        (job) => (job.payload_snapshot as { isAddition?: boolean }).isAddition === true,
      );
      check(Boolean(addition), "an addition ticket exists");
      const lines = (addition!.payload_snapshot as { lines: { productName: string }[] }).lines;
      check(
        lines.length === 1 && lines[0].productName === `${PREFIX}Çay`,
        `only the new line is reprinted (got ${JSON.stringify(lines)})`,
      );
      check(
        String(addition!.printer_id) === ids.barPrinter,
        "and it goes to the station that line belongs to",
      );
    });

    test("an order with no route still succeeds, and the gap is reported", async () => {
      await sql`update printer_routes set is_active = false
        where restaurant_id = ${ids.restaurant} and document_type = 'KITCHEN_ORDER'`;
      const orderId = await newOrder();
      const outcome = await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      check(outcome.created === 0, "no ticket is queued");
      check(outcome.unrouted === 2, `both lines are reported unrouted (got ${outcome.unrouted})`);

      // The order itself is untouched: printing never fails an order.
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "CONFIRMED", `the order stands (got ${order.status})`);
      await sql`update printer_routes set is_active = true
        where restaurant_id = ${ids.restaurant} and document_type = 'KITCHEN_ORDER'`;
    });

    test("a retired printer takes no new work but keeps its history", async () => {
      const before = await sql`
        select count(*)::int as count from print_jobs
        where restaurant_id = ${ids.restaurant} and printer_id = ${ids.barPrinter}`;
      check(Number(before[0].count) > 0, "the bar printer has history");

      await sql`update restaurant_printers set is_active = false where id = ${ids.barPrinter}`;
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const jobs = await jobsFor(orderId);
      check(
        jobs.every((job) => job.printer_id !== ids.barPrinter),
        "a deactivated printer receives nothing new",
      );
      check(
        jobs.some((job) => job.printer_id === ids.kitchenPrinter),
        "and the rest of the order still prints",
      );

      const after = await sql`
        select count(*)::int as count from print_jobs
        where restaurant_id = ${ids.restaurant} and printer_id = ${ids.barPrinter}`;
      check(
        Number(after[0].count) === Number(before[0].count),
        "its earlier jobs are untouched",
      );
      await sql`update restaurant_printers set is_active = true where id = ${ids.barPrinter}`;
    });

    // -------------------------------------------------------------- claim
    test("two workers racing for one job produce exactly one claim", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });

      const [left, right] = await Promise.all([
        printing.claim(agent(), 20),
        printing.claim(agent(), 20),
      ]);
      const claimedIds = [...left, ...right].map((job) => job.jobId);
      check(
        new Set(claimedIds).size === claimedIds.length,
        `no job is handed to two workers (got ${claimedIds.join(", ")})`,
      );

      const jobs = await jobsFor(orderId);
      check(
        jobs.every((job) => job.status === "PROCESSING" && job.attempt_count === 1),
        "each job is claimed exactly once",
      );
      for (const job of [...left, ...right]) {
        check(job.escposBase64.length > 0, "the agent receives rendered bytes");
        check(
          ["kitchen-main", "bar-main", "receipt-main"].includes(job.deviceKey),
          `and a device key to resolve locally (got ${job.deviceKey})`,
        );
      }
    });

    test("an expired lease is reclaimable; a live one is not", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const first = await printing.claim(agent(), 20);
      const target = first.find((job) => job.jobId);
      check(Boolean(target), "a job was claimed");

      // While the lease is live nobody else may take it.
      const blocked = await printing.claim(agent(), 20);
      check(
        !blocked.some((job) => job.jobId === target!.jobId),
        "a live lease is respected",
      );

      // The agent crashed; the lease expires on the server's clock.
      await sql`update print_jobs set lease_until = now() - interval '1 minute'
        where id = ${target!.jobId}`;
      const reclaimed = await printing.claim(agent(), 20);
      check(
        reclaimed.some((job) => job.jobId === target!.jobId),
        "an expired lease returns the job to the queue",
      );
      const [row] = await sql`select attempt_count from print_jobs where id = ${target!.jobId}`;
      check(Number(row.attempt_count) === 2, `the second attempt is counted (got ${row.attempt_count})`);
    });

    test("an agent reaches only its own restaurant's work", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const stolen = await printing.claim(foreignAgent(), 20);
      check(stolen.length === 0, `a foreign agent claims nothing (got ${stolen.length})`);

      const jobs = await jobsFor(orderId);
      check(
        jobs.every((job) => job.status === "PENDING"),
        "the work is still waiting for its own agent",
      );
      // And it cannot complete or fail somebody else's job either.
      check(
        (await code(() => printing.complete(foreignAgent(), String(jobs[0].id), 10))) ===
          "NOT_FOUND",
        "completing a foreign job is refused",
      );
      check(
        (await code(() =>
          printing.fail(foreignAgent(), String(jobs[0].id), "PRINTER_WRITE_FAILED", "x"),
        )) === "NOT_FOUND",
        "failing a foreign job is refused",
      );
    });

    // ------------------------------------------------------ real transport
    test("claimed bytes reach a real socket and the job completes", async () => {
      received.length = 0;
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const claimed = (await printing.claim(agent(), 20)).filter((job) =>
        job.deviceKey === "kitchen-main",
      );
      check(claimed.length >= 1, "a kitchen job was claimed");
      const job = claimed[0]!;

      const payload = Buffer.from(job.escposBase64, "base64");
      const result = await sendToDevice(
        { transport: "tcp", host: "127.0.0.1", port: mockPort },
        payload,
      );
      check(result.bytesWritten === payload.byteLength, "every byte was written");

      // Give the mock a moment to drain, then confirm the wire content.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const wire = Buffer.concat(received);
      check(wire.byteLength === payload.byteLength, `the printer received the bytes (${wire.byteLength})`);
      check(wire[0] === 0x1b && wire[1] === 0x40, "the stream starts with ESC @ (initialise)");
      // CP857 renders Turkish letters as single high bytes, not as UTF-8 pairs.
      check(wire.includes(0x9e) || wire.includes(0x8d), "Turkish letters arrive code-paged");

      await printing.complete(agent(), job.jobId, result.bytesWritten);
      const [row] = await sql`
        select status::text as status, printed_at is not null as printed
        from print_jobs where id = ${job.jobId}`;
      check(row.status === "PRINTED" && row.printed === true, "the job is marked printed");

      const [attempt] = await sql`
        select succeeded, bytes_written from print_job_attempts
        where print_job_id = ${job.jobId} order by attempt_number desc limit 1`;
      check(
        attempt.succeeded === true && Number(attempt.bytes_written) === payload.byteLength,
        "the attempt history records the delivery",
      );
    });

    test("an unreachable printer fails the job without touching anything else", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const claimed = await printing.claim(agent(), 20);
      const job = claimed[0]!;

      // A port nobody is listening on: the everyday "printer is switched off".
      const closed = net.createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const deadPort = (closed.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));

      const failure = await sendToDevice(
        { transport: "tcp", host: "127.0.0.1", port: deadPort },
        Buffer.from(job.escposBase64, "base64"),
      ).then(
        () => null,
        (error: Error & { code?: string }) => error,
      );
      check(Boolean(failure), "the socket refuses the connection");
      check(
        (failure as { code?: string })?.code === "PRINTER_CONNECTION_FAILED",
        `a business-safe code, not a raw error (got ${(failure as { code?: string })?.code})`,
      );

      const reported = await printing.fail(
        agent(),
        job.jobId,
        "PRINTER_CONNECTION_FAILED",
        "Connection refused.",
      );
      check(reported.status === "PENDING", `the job waits behind a backoff (${reported.status})`);
      check(Boolean(reported.retryAtIso), "with a retry time");

      const [row] = await sql`
        select status::text as status, last_error_code, available_at > now() as backing_off
        from print_jobs where id = ${job.jobId}`;
      check(row.last_error_code === "PRINTER_CONNECTION_FAILED", "the code is recorded");
      check(row.backing_off === true, "and it is not retried immediately");

      // The order is entirely unaffected by the printer being off.
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "CONFIRMED", `the order stands (got ${order.status})`);
    });

    test("a job that keeps failing becomes terminal rather than looping forever", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const [job] = await jobsFor(orderId);
      const jobId = String(job.id);

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sql`update print_jobs set available_at = now() - interval '1 second',
          lease_until = null where id = ${jobId}`;
        const claimed = await printing.claim(agent(), 20);
        if (!claimed.some((row) => row.jobId === jobId)) break;
        await printing.fail(agent(), jobId, "PRINTER_WRITE_FAILED", "still off");
      }

      const [row] = await sql`
        select status::text as status, attempt_count, failed_at is not null as failed
        from print_jobs where id = ${jobId}`;
      check(row.status === "FAILED", `it ends FAILED (got ${row.status})`);
      check(row.failed === true, "with a failure time for the admin screen");
      check(Number(row.attempt_count) <= 50, "and a bounded attempt count");

      // A human can put it back in the queue; that is a retry, not a reprint.
      const retried = await printing.retry(manager(), jobId);
      check(retried.status === "PENDING", `manual retry requeues it (${retried.status})`);
      const [after] = await sql`
        select status::text as status, reprint_of_job_id from print_jobs where id = ${jobId}`;
      check(after.reprint_of_job_id === null, "a retry never creates a reprint link");
      const attempts = await sql`
        select count(*)::int as count from print_job_attempts where print_job_id = ${jobId}`;
      check(Number(attempts[0].count) >= 2, "every attempt is kept as history");
    });

    // ------------------------------------------------------------ reprint
    test("a reprint is a new job carrying the original snapshot, with a reason", async () => {
      const orderId = await newOrder();
      await enqueueKitchenTickets(db, {
        restaurantId: ids.restaurant,
        orderId,
        kind: "NEW",
        occurrence: "confirm",
      });
      const [original] = await jobsFor(orderId);
      const originalId = String(original.id);
      await sql`update print_jobs set status = 'PRINTED', printed_at = now() where id = ${originalId}`;

      check(
        (await code(() => printing.reprint(manager(), originalId, "   "))) ===
          "VALIDATION_ERROR",
        "an unexplained reprint is refused",
      );

      const reprint = await printing.reprint(manager(), originalId, "Fiş yırtıldı");
      check(reprint.jobId !== originalId, "it is a new job");

      const [copy] = await sql`
        select reprint_of_job_id, reprint_reason, status::text as status, payload_snapshot,
          dedupe_key, printer_id
        from print_jobs where id = ${reprint.jobId}`;
      check(String(copy.reprint_of_job_id) === originalId, "linked to the original");
      check(String(copy.reprint_reason) === "Fiş yırtıldı", "with the stated reason");
      check(copy.status === "PENDING", "and queued for delivery");
      check(copy.dedupe_key === null, "a reprint is a new occurrence, so it is not deduped");
      check(String(copy.printer_id) === String(original.printer_id), "to the same printer");

      const originalLines = (original.payload_snapshot as { lines: unknown }).lines;
      const copyLines = (copy.payload_snapshot as { lines: unknown }).lines;
      assert.deepEqual(copyLines, originalLines, "the original document is reproduced exactly");
      assertions += 1;
      check(
        (copy.payload_snapshot as { reprintOfJobId?: string }).reprintOfJobId === originalId,
        "and the paper says it is a duplicate",
      );

      // The original is untouched.
      const [unchanged] = await sql`
        select status::text as status, reprint_of_job_id, reprint_reason
        from print_jobs where id = ${originalId}`;
      check(
        unchanged.status === "PRINTED" &&
          unchanged.reprint_of_job_id === null &&
          unchanged.reprint_reason === null,
        "the original job is never rewritten",
      );

      // A reprint of a reprint still points at the true original.
      const second = await printing.reprint(manager(), reprint.jobId, "Müşteri istedi");
      const [chained] = await sql`
        select reprint_of_job_id from print_jobs where id = ${second.jobId}`;
      check(
        String(chained.reprint_of_job_id) === originalId,
        "the chain resolves to the first document",
      );
    });

    // -------------------------------------------------- documents from data
    test("the guest bill is built from the ledger, not from the request", async () => {
      const orderId = await newOrder();
      await sql`insert into payments (id, restaurant_id, order_id, amount, method, status,
          created_by_user_id, processed_at) values
        (${randomUUID()}, ${ids.restaurant}, ${orderId}, '100.00', 'CASH', 'COMPLETED',
         ${ids.manager}, now())`;

      const bill = await new PrintDocumentService(db).customerBill(ids.restaurant, orderId);
      check(bill.total === "250.00", `the order total (got ${bill.total})`);
      check(bill.paidTotal === "100.00", `what was collected (got ${bill.paidTotal})`);
      check(bill.outstanding === "150.00", `what is still owed (got ${bill.outstanding})`);
      check(bill.lines.length === 2, `both sold lines (got ${bill.lines.length})`);
      check(
        bill.lines.every((line) => line.productName.startsWith(PREFIX)),
        "with the names as sold",
      );
      check(
        !JSON.stringify(bill).match(/pan|cvv|expiry|card_number/i),
        "and nothing resembling card data",
      );
    });

    test("a payment copy carries the method and no instrument detail at all", async () => {
      const orderId = await newOrder();
      const paymentId = randomUUID();
      await sql`insert into payments (id, restaurant_id, order_id, amount, method, status,
          created_by_user_id, processed_at) values
        (${paymentId}, ${ids.restaurant}, ${orderId}, '250.00', 'CARD', 'COMPLETED',
         ${ids.manager}, now())`;

      const receipt = await new PrintDocumentService(db).paymentReceipt(ids.restaurant, paymentId);
      check(receipt.amount === "250.00", `the amount (got ${receipt.amount})`);
      check(receipt.method === "Kart", `the method in Turkish (got ${receipt.method})`);
      check(receipt.outstanding === "0.00", "and the resulting balance");
      const serialised = JSON.stringify(receipt);
      check(
        !/\b\d{13,19}\b/.test(serialised),
        "no field could hold a card number",
      );
      check(!/cvv|expiry|pan/i.test(serialised), "and none is named for one");
    });

    // ----------------------------------------------------------- retention
    test("maintenance never deletes print history", async () => {
      const [before] = await sql`
        select
          (select count(*)::int from print_jobs where restaurant_id = ${ids.restaurant}) as jobs,
          (select count(*)::int from print_job_attempts where restaurant_id = ${ids.restaurant}) as attempts,
          (select count(*)::int from printer_agents where restaurant_id = ${ids.restaurant}) as agents,
          (select count(*)::int from restaurant_printers where restaurant_id = ${ids.restaurant}) as printers,
          (select count(*)::int from printer_routes where restaurant_id = ${ids.restaurant}) as routes`;
      check(Number(before.jobs) > 0 && Number(before.attempts) > 0, "there is history to protect");

      const result = await new DataMaintenanceService(db).run({ dryRun: false });
      check(result.errors.length === 0, `maintenance ran clean (${result.errors.join(", ")})`);
      check(
        result.operations.every(
          (operation) => !operation.table.startsWith("print") && operation.table !== "restaurant_printers",
        ),
        "no printing table is even a cleanup target",
      );

      const [after] = await sql`
        select
          (select count(*)::int from print_jobs where restaurant_id = ${ids.restaurant}) as jobs,
          (select count(*)::int from print_job_attempts where restaurant_id = ${ids.restaurant}) as attempts,
          (select count(*)::int from printer_agents where restaurant_id = ${ids.restaurant}) as agents,
          (select count(*)::int from restaurant_printers where restaurant_id = ${ids.restaurant}) as printers,
          (select count(*)::int from printer_routes where restaurant_id = ${ids.restaurant}) as routes`;
      assert.deepEqual(after, before, "print history is untouched by retention maintenance");
      assertions += 1;
    });

    test("history is paginated with a stable order", async () => {
      const first = await printing.history(manager(), { page: 1, pageSize: 3 });
      const second = await printing.history(manager(), { page: 2, pageSize: 3 });
      check(first.rows.length === 3, `a full page (got ${first.rows.length})`);
      check(first.total > 3, `and more behind it (got ${first.total})`);
      check(
        first.rows.every((row) => !second.rows.some((other) => other.id === row.id)),
        "pages never overlap",
      );
      const filtered = await printing.history(manager(), {
        documentType: "KITCHEN_ORDER",
        page: 1,
        pageSize: 50,
      });
      check(
        filtered.rows.every((row) => row.documentType === "KITCHEN_ORDER"),
        "the filter is applied in SQL",
      );
    });
  });
}
