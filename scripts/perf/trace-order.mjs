import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env"; const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());
import { fixtureRateLimitKeys } from "../../tests/integration/rate-limit-reset.ts";
const BASE = "http://localhost:3100";
const STATE = process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fx = JSON.parse(readFileSync(STATE, "utf8"));
const LOG = process.argv[2];
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
const keys = fixtureRateLimitKeys([...fx.tables.map(t=>t.id)], [fx.restaurantId]);
const cookies = new Map();
const jar = () => [...cookies].map(([k,v])=>`${k}=${v}`).join("; ");
function absorb(r){for(const raw of r.headers.getSetCookie()){const [p]=raw.split(";");const i=p.indexOf("=");if(i>0)cookies.set(p.slice(0,i).trim(),p.slice(i+1).trim());}}
const size=()=>{try{return statSync(LOG).size}catch{return 0}};
function slice(a,b){const buf=Buffer.alloc(b-a);const fd=openSync(LOG,"r");readSync(fd,buf,0,buf.length,a);closeSync(fd);return buf.toString("utf8").split(/\r?\n/).filter(l=>l.startsWith("[SQLPERF]"));}
await sql`delete from api_rate_limits where key_hash = any(${keys})`;
let r = await fetch(new URL("/api/table-sessions", BASE), {method:"POST",headers:{Origin:BASE,"Content-Type":"application/json"},body:JSON.stringify({tableToken:fx.tables[1].rawToken})});
absorb(r);
for (let n = 0; n < 3; n++) {
  await sql`delete from api_rate_limits where key_hash = any(${keys})`;
  const before = size();
  const t0 = process.hrtime.bigint();
  r = await fetch(new URL("/api/orders", BASE), {
    method: "POST",
    headers: { Origin: BASE, Cookie: jar(), "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ items: fx.products.slice(0,3).map(p=>({productId:p,quantity:1})) }),
  });
  await r.text();
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  await new Promise(res=>setTimeout(res,120));
  const rows = slice(before, size()).map(l=>l.split("\t"));
  const first = rows.length ? BigInt(rows[0][1]) : 0n;
  const last = rows.length ? BigInt(rows[rows.length-1][1]) : 0n;
  console.log(`\n#${n+1} status=${r.status} wall=${wall.toFixed(0)}ms  statements=${rows.length}  first→last send span=${(Number(last-first)/1e6).toFixed(0)}ms`);
  let prev=null;
  for (const p of rows) { const ts=BigInt(p[1]); const gap=prev===null?0:Number(ts-prev)/1e6; prev=ts;
    console.log(`   +${gap.toFixed(1).padStart(6)}ms c${p[2]}  ${p[4].slice(0,60)}`); }
}
await sql.end({timeout:5});
