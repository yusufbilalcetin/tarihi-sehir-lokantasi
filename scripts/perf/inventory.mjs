import nextEnv from "@next/env"; const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());
const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false, onnotice: () => {} });
const [{ count: restaurants }] = await sql`select count(*)::int from restaurants`;
console.log("restaurants:", restaurants);
console.log(await sql`select id, name, slug, created_at from restaurants order by created_at limit 10`);
const tables = ["orders","order_items","payments","payment_refunds","restaurant_tables","waiter_calls","outbox_events","print_jobs","audit_logs","order_events","cashier_shifts","products","categories","staff_profiles","order_checks","order_check_items","idempotency_keys","api_rate_limits"];
for (const t of tables) {
  const [row] = await sql.unsafe(`select count(*)::int as n from ${t}`).catch(() => [{ n: "n/a" }]);
  console.log(t.padEnd(22), row.n);
}
await sql.end({ timeout: 5 });
