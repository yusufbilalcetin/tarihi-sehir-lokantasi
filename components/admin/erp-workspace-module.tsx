"use client";

import { BadgeDollarSign, BarChart3, Boxes, Building2, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, CookingPot, Factory, HeartHandshake, History, PackageCheck, PackageOpen, PlugZap, ReceiptText, ShoppingBag, Star, TrendingUp, Truck, UsersRound, WalletCards, type LucideIcon } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { ErpWorkspaceManager } from "@/components/admin/erp-workspace-manager";
import { ERP_UI_CONFIG } from "@/lib/domain/erp-ui";
import type { ErpWorkspaceModule } from "@/lib/domain/erp-workspaces";

const icons: Record<ErpWorkspaceModule, LucideIcon> = {
  sales: TrendingUp, "stock-movements": History, "stock-counts": ClipboardCheck,
  inventory: Boxes, warehouses: Building2, recipes: CookingPot, costing: BadgeDollarSign,
  production: Factory, waste: History, suppliers: Truck, purchasing: ClipboardList,
  payables: WalletCards, "price-history": TrendingUp, forecast: CalendarClock, "menu-engineering": BarChart3, popular: Star,
  attendance: ClipboardCheck, schedules: CalendarDays, payroll: ReceiptText, feedback: HeartHandshake,
  reservations: CalendarDays, fulfillment: ShoppingBag, customers: UsersRound, loyalty: HeartHandshake, integrations: PlugZap,
  reports: PackageCheck,
};

export function ErpWorkspaceModule({ module }: { readonly module: ErpWorkspaceModule }) {
  const config = ERP_UI_CONFIG[module];
  const Icon = icons[module] ?? PackageOpen;
  return <AdminModuleWindow title={config.title} description={config.description} icon={Icon} size="workspace"><ErpWorkspaceManager module={module} icon={Icon} /></AdminModuleWindow>;
}
