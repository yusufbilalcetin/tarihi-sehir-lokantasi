"use client";

import { useState } from "react";
import { CircleCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { ApiClientError } from "@/lib/api/client";
import { adminApi } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";

export function QrAccessToggle({
  tableId,
  tableName,
  paused,
  onChanged,
  className,
}: {
  readonly tableId: string;
  readonly tableName: string;
  readonly paused: boolean;
  readonly onChanged: () => Promise<void> | void;
  readonly className?: string;
}) {
  const [confirmingPause, setConfirmingPause] = useState(false);
  const [pending, setPending] = useState(false);

  async function changeAccess(nextPaused: boolean) {
    if (pending) return;
    setPending(true);
    try {
      if (nextPaused) await adminApi.pauseTableQr(tableId);
      else await adminApi.resumeTableQr(tableId);
      await onChanged();
      setConfirmingPause(false);
      toast.success(
        nextPaused
          ? "QR menü geçici olarak durduruldu."
          : "QR menü yeniden etkinleştirildi.",
      );
    } catch (error) {
      const fallback = nextPaused
        ? "QR menü durdurulamadı."
        : "QR menü etkinleştirilemedi.";
      toast.error(fallback, {
        description: error instanceof ApiClientError ? error.message : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={paused ? "default" : "ghost"}
        className={cn(
          "min-h-11",
          !paused && "text-muted-foreground hover:text-destructive",
          className,
        )}
        disabled={pending}
        aria-busy={pending}
        aria-label={`${tableName} QR menüsünü ${paused ? "etkinleştir" : "durdur"}`}
        onClick={() => paused ? void changeAccess(false) : setConfirmingPause(true)}
      >
        {paused ? <CircleCheck /> : <ShieldOff />}
        {paused ? "Etkinleştir" : "Durdur"}
      </Button>

      {!paused ? <Dialog open={confirmingPause} onOpenChange={setConfirmingPause}>
        <WindowDialogContent
          size="sm"
          title="QR Menüyü Durdur"
          description={`${tableName} için QR menü erişimini geçici olarak durdurmak istiyor musunuz?`}
          footer={
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingPause(false)}>
                Vazgeç
              </Button>
              <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void changeAccess(true)}>
                Durdur
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6 text-muted-foreground">
            QR daha sonra aynı kodla tekrar etkinleştirilebilir. Masadaki basılı kodu değiştirmeniz gerekmez.
          </p>
        </WindowDialogContent>
      </Dialog> : null}
    </>
  );
}
