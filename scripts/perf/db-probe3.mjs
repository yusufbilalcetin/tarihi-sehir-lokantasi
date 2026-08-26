import nextEnv from "@next/env"; const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL;
const now = () => process.hrtime.bigint();
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const med = (l) => [...l].sort((a,b)=>a-b)[Math.floor(l.length/2)].toFixed(1);

async function bench(label, opts, run) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, ...opts });
  await sql`select 1`;
  const times = [];
  for (let i = 0; i < 12; i++) { const t = now(); await run(sql, i); times.push(ms(t)); }
  console.log(`  ${label.padEnd(46)} median ${med(times)}ms`);
  await sql.end({ timeout: 5 });
}

console.log("per-statement wall time on one warm connection:");
await bench("tagged template, prepare:false", { prepare: false }, (sql) => sql`select 1`);
await bench("tagged template + param, prepare:false", { prepare: false }, (sql, i) => sql`select ${i}::int`);
await bench("tagged template + param, prepare:true", { prepare: true }, (sql, i) => sql`select ${i}::int`);
await bench("unsafe + param, prepare:false", { prepare: false }, (sql, i) => sql.unsafe("select $1::int", [i]));
await bench("unsafe + param, prepare:true", { prepare: true }, (sql, i) => sql.unsafe("select $1::int", [i]));
await bench("unsafe no param, prepare:false", { prepare: false }, () => sql0());
function sql0() {}
