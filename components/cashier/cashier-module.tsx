"use client";

import { Wallet } from "lucide-react";

import { ModuleWindow } from "@/components/shared/module-window";
import { CashierDashboard } from "@/components/cashier/cashier-dashboard";

/**
 * The till as an application window.
 *
 * `workspace` because the till is a list of open bills beside the bill being
 * settled, and squeezing that pair costs the cashier the one comparison that
 * prevents mistakes. Closing stays on the till: like the kitchen, this is the
 * screen the role lives on rather than a detour from somewhere else.
 */
export function CashierModule() {
  return (
    <ModuleWindow
      title="Kasa"
      description="Açık hesapları görüntüle, tahsilat al ve vardiyayı yönet."
      icon={Wallet}
      size="workspace"
      closeHref="/cashier"
    >
      <CashierDashboard inWindow />
    </ModuleWindow>
  );
}
