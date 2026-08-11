"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { categorySales, hourlyOrders, weeklySales } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";

const chartColors = ["#681F25", "#B98352", "#30382D", "#8C704A", "#746B61"];

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

export function DashboardSalesChart() {
  return (
    <div className="h-[290px] w-full" role="img" aria-label="Haftalık satış grafiği">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={weeklySales} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
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

export function ReportSalesChart() {
  return (
    <div className="h-[310px] w-full" role="img" aria-label="Satış ve sipariş trendi grafiği">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={weeklySales} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="reportSalesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#681F25" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#681F25" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#E5D6C4" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#746B61", fontSize: 12 }} dy={9} />
          <YAxis
            yAxisId="sales"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#746B61", fontSize: 11 }}
            tickFormatter={(value) => `${Math.round(Number(value) / 1000)} bin`}
          />
          <YAxis yAxisId="orders" orientation="right" hide domain={[0, "dataMax + 20"]} />
          <Tooltip content={<SalesTooltip />} cursor={{ stroke: "#B98352", strokeDasharray: "4 4" }} />
          <Area yAxisId="sales" type="monotone" dataKey="sales" stroke="#681F25" strokeWidth={2.5} fill="url(#reportSalesFill)" />
          <Area yAxisId="orders" type="monotone" dataKey="orders" stroke="#B98352" strokeWidth={2} fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategorySalesChart() {
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(180px,0.9fr)_minmax(170px,1fr)]">
      <div className="h-[220px]" role="img" aria-label="Kategori bazında satış dağılımı">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={categorySales} dataKey="value" nameKey="name" innerRadius={54} outerRadius={84} paddingAngle={3} stroke="none">
              {categorySales.map((entry, index) => (
                <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`%${Number(value)}`, String(name)]}
              contentStyle={{ borderRadius: 12, borderColor: "#E5D6C4", background: "#FFFDF8", fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2.5">
        {categorySales.map((item, index) => (
          <div key={item.name} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: chartColors[index] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.name}</span>
            <strong className="tabular-nums text-foreground">%{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HourlyOrdersChart() {
  return (
    <div className="h-[280px] w-full" role="img" aria-label="Saat bazında sipariş grafiği">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={hourlyOrders} margin={{ top: 8, right: 4, left: -28, bottom: 0 }}>
          <CartesianGrid stroke="#E5D6C4" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: "#746B61", fontSize: 10 }} dy={8} interval={1} />
          <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: "#746B61", fontSize: 11 }} />
          <Tooltip
            formatter={(value) => [`${Number(value)} sipariş`, "Sipariş"]}
            contentStyle={{ borderRadius: 12, borderColor: "#E5D6C4", background: "#FFFDF8", fontSize: 12 }}
            cursor={{ fill: "rgba(185,131,82,0.08)" }}
          />
          <Bar dataKey="orders" fill="#30382D" radius={[6, 6, 2, 2]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

