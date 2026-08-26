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
  for (let i = 0; i < 10; i++) { const t = now(); await run(sql, i); times.push(ms(t)); }
  console.log(`  ${label.padEnd(58)} median ${med(times)}ms`);
  await sql.end({ timeout: 5 });
}
const q = 'select $1::int as v, $2::text as t';
await bench("pool prepare:true, plain unsafe(q,p)", { prepare: true }, (s,i)=>s.unsafe(q,[i,"x"]));
await bench("pool prepare:true, unsafe(q,p,{prepare:true})", { prepare: true }, (s,i)=>s.unsafe(q,[i,"x"],{prepare:true}));
console.log("\ntransactions:");
await bench("tx(4 sequential stmts) today", { prepare: false }, (s,i)=>s.begin(async tx=>{for(let k=0;k<4;k++) await tx.unsafe(q,[i,"x"]);}));
await bench("tx(4 sequential stmts) prepared", { prepare: true }, (s,i)=>s.begin(async tx=>{for(let k=0;k<4;k++) await tx.unsafe(q,[i,"x"],{prepare:true});}));
await bench("tx(4 pipelined stmts) prepared", { prepare: true }, (s,i)=>s.begin(tx=>Promise.all([0,1,2,3].map(()=>tx.unsafe(q,[i,"x"],{prepare:true})))));
