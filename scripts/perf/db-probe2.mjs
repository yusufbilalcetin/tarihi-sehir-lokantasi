/** Phase 32: transaction concurrency under the app's pool settings + pooler mode comparison. */
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;
const txUrl = url.replace(/(@[^:/?]+):5432/, "$1:6543");
const now = () => process.hrtime.bigint();
const ms = (t) => Number((Number(process.hrtime.bigint() - t) / 1e6).toFixed(1));
const stats = (l) => { const s=[...l].sort((a,b)=>a-b); const at=p=>s[Math.min(s.length-1,Math.floor(p/100*s.length))];
  return {n:s.length,min:s[0],p50:at(50),p95:at(95),max:s[s.length-1]}; };

async function txBurst(sql, label, n, queriesPerTx) {
  const t = now();
  const each = await Promise.all(Array.from({length:n}, async () => {
    const t2 = now();
    await sql.begin(async (tx) => { for (let i=0;i<queriesPerTx;i++) await tx`select 1`; });
    return ms(t2);
  }));
  console.log(`  ${label}: wall=${ms(t)}ms per-tx=${JSON.stringify(stats(each))}`);
}

async function main() {
  for (const max of [1, 5, 10]) {
    const sql = postgres(url, { max, prepare: false, onnotice: () => {} });
    // warm every slot so handshake cost is out of the measurement
    await Promise.all(Array.from({length:max}, () => sql`select pg_sleep(0.05)`));
    console.log(`\n== session pooler (5432), pool max=${max} ==`);
    await txBurst(sql, "10 concurrent tx x 4 queries", 10, 4);
    await txBurst(sql, "25 concurrent tx x 4 queries", 25, 4);
    await sql.end({ timeout: 5 });
  }

  console.log("\n== transaction pooler (6543) reachability + latency ==");
  try {
    const sql = postgres(txUrl, { max: 5, prepare: false, onnotice: () => {}, connect_timeout: 10 });
    const t = now(); await sql`select 1`; console.log(`  cold=${ms(t)}ms`);
    const rt=[]; for (let i=0;i<15;i++){const t2=now(); await sql`select 1`; rt.push(ms(t2));}
    console.log(`  warm rtt=${JSON.stringify(stats(rt))}`);
    await Promise.all(Array.from({length:5}, () => sql`select 1`));
    await txBurst(sql, "10 concurrent tx x 4 queries", 10, 4);
    await txBurst(sql, "25 concurrent tx x 4 queries", 25, 4);
    await sql.end({ timeout: 5 });
  } catch (e) { console.log("  unavailable:", e.message); }

  console.log("\n== sequential vs parallel round-trips (network cost of N+1) ==");
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  await Promise.all(Array.from({length:5}, () => sql`select 1`));
  for (const n of [1, 4, 8, 16]) {
    const ts = now(); for (let i=0;i<n;i++) await sql`select 1`; const seq = ms(ts);
    const tp = now(); await Promise.all(Array.from({length:n}, () => sql`select 1`)); const par = ms(tp);
    console.log(`  ${String(n).padStart(2)} queries: sequential=${seq}ms  pipelined/parallel=${par}ms`);
  }
  await sql.end({ timeout: 5 });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
