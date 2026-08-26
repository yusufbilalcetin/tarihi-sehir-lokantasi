/**
 * Phase 32 A4/A5/A6 probe: separates TCP+TLS+auth connection cost from SQL
 * execution cost. Reads DATABASE_URL from the Next env files; never prints it.
 *
 * usage: node --import tsx scripts/perf/db-probe.mjs   (or: node scripts/perf/db-probe.mjs)
 */
import net from "node:net";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const host = url.match(/@([^:/?]+)/)[1];
const port = Number(url.match(/@[^:/?]+:(\d+)/)?.[1] ?? 5432);

const ms = (t) => Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(1));
const now = () => process.hrtime.bigint();

function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { n: s.length, min: s[0], p50: at(50), p95: at(95), p99: at(99), max: s[s.length - 1] };
}

async function tcpRtt(times) {
  const out = [];
  for (let i = 0; i < times; i++) {
    const t = now();
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port }, () => { out.push(ms(t)); socket.destroy(); resolve(); });
      socket.on("error", reject);
    });
  }
  return stats(out);
}

async function main() {
  console.log(`# target host tail: ${host.split(".").slice(1).join(".")} port ${port}`);

  console.log("\n== 1. Raw TCP connect RTT (network only, no TLS/auth) ==");
  console.log(JSON.stringify(await tcpRtt(5)));

  console.log("\n== 2. Cold connection: first query includes TCP+TLS+auth ==");
  for (let i = 0; i < 3; i++) {
    const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    const t = now();
    await sql`select 1 as ok`;
    const cold = ms(t);
    const t2 = now();
    await sql`select 1 as ok`;
    const warm = ms(t2);
    console.log(`  run ${i + 1}: cold(connect+query)=${cold}ms  warm(query only)=${warm}ms  => handshake≈${(cold - warm).toFixed(1)}ms`);
    await sql.end({ timeout: 5 });
  }

  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  await sql`select 1`;

  console.log("\n== 3. Warm round-trip latency (select 1, x30) ==");
  const rt = [];
  for (let i = 0; i < 30; i++) { const t = now(); await sql`select 1`; rt.push(ms(t)); }
  console.log("  " + JSON.stringify(stats(rt)));

  console.log("\n== 4. Server-side execution vs wall clock ==");
  const t4 = now();
  const [srv] = await sql`select clock_timestamp() as a, pg_sleep(0) , clock_timestamp() as b`;
  console.log(`  wall=${ms(t4)}ms  server-side delta=${(new Date(srv.b) - new Date(srv.a))}ms  => transport dominates when wall >> delta`);

  console.log("\n== 5. Server metadata ==");
  const [meta] = await sql`select current_setting('server_version') as version, current_setting('TimeZone') as tz, inet_server_addr()::text as server_ip`;
  console.log(`  postgres ${meta.version}  tz=${meta.tz}`);
  const [conn] = await sql`select count(*)::int as total, count(*) filter (where state='active')::int as active from pg_stat_activity`;
  const [lim] = await sql`select setting::int as max_connections from pg_settings where name='max_connections'`;
  console.log(`  pg_stat_activity total=${conn.total} active=${conn.active}  max_connections=${lim.max_connections}`);
  const [ssl] = await sql`select ssl, version from pg_stat_ssl where pid = pg_backend_pid()`.catch(() => [{ ssl: "n/a", version: "n/a" }]);
  console.log(`  ssl=${ssl.ssl} ${ssl.version ?? ""}`);
  // Session pooler keeps a dedicated backend; transaction pooler multiplexes.
  const [poolMode] = await sql`select current_setting('application_name', true) as app`;
  console.log(`  application_name=${poolMode.app || "(unset)"}`);

  console.log("\n== 6. Concurrency: 10 parallel trivial queries on max=5 pool ==");
  const t6 = now();
  const par = await Promise.all(Array.from({ length: 10 }, async () => { const t = now(); await sql`select 1`; return ms(t); }));
  console.log(`  wall=${ms(t6)}ms per-query=${JSON.stringify(stats(par))}`);

  console.log("\n== 7. Same, on a max=1 pool (the app's runtime setting) ==");
  const single = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await single`select 1`;
  const t7 = now();
  const par1 = await Promise.all(Array.from({ length: 10 }, async () => { const t = now(); await single`select 1`; return ms(t); }));
  console.log(`  wall=${ms(t7)}ms per-query=${JSON.stringify(stats(par1))}`);
  await single.end({ timeout: 5 });

  await sql.end({ timeout: 5 });
}

main().catch((error) => { console.error("probe failed:", error.message); process.exitCode = 1; });
