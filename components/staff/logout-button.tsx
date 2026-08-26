"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * The logout route answers with `redirectTo` instead of the standard API
 * envelope, so this deliberately calls fetch rather than the shared client.
 */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/staff/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
      router.replace("/staff/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
      toast.error("Çıkış yapılamadı. Lütfen tekrar deneyin.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoggingOut}
      aria-busy={isLoggingOut}
      className={cn(
        "flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:opacity-60",
        className,
      )}
      aria-label="Panelden çıkış yap"
    >
      <LogOut className="size-5" strokeWidth={1.8} />
    </button>
  );
}
