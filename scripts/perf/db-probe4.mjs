import nextEnv from "@next/env"; const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL;
const now = () => process.hrtime.bigint();
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const med = (l) => [...l].sort((a,b)=>a-b)[Math.floor(l.length/2)].toFixed(1);

async function bench(label, connOpts, run) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ...connOpts });
  await sql`select 1`;
  const times = [];
  for (let i = 0; i < 12; i++) { const t = now(); await run(sql, i); times.push(ms(t)); }
  console.log(`  ${label.padEnd(56)} median ${med(times)}ms  first=${times[0].toFixed(1)}ms`);
  await sql.end({ timeout: 5 });
}

const q = 'select $1::int as v, $2::text as t';
await bench("unsafe(q,p) — as drizzle calls it today", { prepare: false }, (s,i)=>s.unsafe(q,[i,"x"]));
await bench("unsafe(q,p,{prepare:true}) on prepare:false pool", { prepare: false }, (s,i)=>s.unsafe(q,[i,"x"],{prepare:true}));
await bench("unsafe(q,p,{prepare:true}) on prepare:true pool", { prepare: true }, (s,i)=>s.unsafe(q,[i,"x"],{prepare:true}));
await bench("unsafe(q,p,{prepare:true}).values()", { prepare: true }, (s,i)=>s.unsafe(q,[i,"x"],{prepare:true}).values());

console.log("\ninside a transaction (drizzle transaction path):");
await bench("tx unsafe(q,p) today", { prepare: false }, (s,i)=>s.begin(tx=>tx.unsafe(q,[i,"x"])));
await bench("tx unsafe(q,p,{prepare:true})", { prepare: false }, (s,i)=>s.begin(tx=>tx.unsafe(q,[i,"x"],{prepare:true})));

console.log("\ntransaction pooler (6543) with prepare:true — must not break:");
const txUrl = url.replace(/(@[^:/?]+):5432/, "$1:6543");
try {
  const sql = postgres(txUrl, { max: 2, prepare: false, onnotice: () => {} });
  for (let i = 0; i < 6; i++) await sql.unsafe(q, [i, "x"], { prepare: true });
  console.log("  6543 + per-query prepare:true: OK (Supavisor tracks named statements)");
  await sql.end({ timeout: 5 });
} catch (e) { console.log("  6543 + prepare:true FAILED:", e.message); }
