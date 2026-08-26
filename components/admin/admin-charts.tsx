"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

export interface SalesPoint {
  readonly label: string;
  readonly sales: number;
  readonly orders: number;
}

function SalesTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number; dataKey?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const sales = payload.find((item) => item.dataKey === "sales")?.value ?? 0;
  const orders = payload.find((item) => item.dataKey === "orders")?.value;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-bold text-foreground">{label}</p>
      <p className="mt-1 font-extrabold tabular-nums text-burgundy">{formatCurrency(Number(sales))}</p>
      {orders !== undefined ? <p className="mt-0.5 text-muted-foreground">{orders} sipariş</p> : null}
    </div>
  );
}

export function DashboardSalesChart({ data }: { data: readonly SalesPoint[] }) {
  return (
    <div className="h-[290px] w-full" role="img" aria-label="Haftalık satış grafiği">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="dashboardSalesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#681F25" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#681F25" stopOpacity={0.015} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E5D6C4" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#746B61", fontSize: 12 }} dy={9} />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#746B61", fontSize: 11 }}
            tickFormatter={(value) => `${Math.round(Number(value) / 1000)} bin`}
          />
          <Tooltip content={<SalesTooltip />} cursor={{ stroke: "#B98352", strokeDasharray: "4 4" }} />
          <Area
            type="monotone"
            dataKey="sales"
            stroke="#681F25"
            strokeWidth={2.5}
            fill="url(#dashboardSalesFill)"
            activeDot={{ r: 5, fill: "#B98352", stroke: "#FFFDF8", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}