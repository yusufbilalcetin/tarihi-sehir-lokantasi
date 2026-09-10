"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { QrPrintDesigner } from "@/components/admin/qr-print-designer";
import { BrandedTableQr } from "@/components/shared/branded-table-qr";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { userErrorMessage } from "@/lib/api/error-message";
import { adminApi, type TableQrCodeRow } from "@/lib/api/endpoints";

export interface TableQrDialogTable {
  readonly id: string;
  readonly name: string;
}

/**
 * One table's QR menu, shown so it can be used rather than administered.
 *
 * Opening it, downloading from it and printing from it are all reads — the
 * code on screen is the code already glued to the table. Renewal is the one
 * action that changes anything, so it sits apart, asks first, and says plainly
 * what it costs.
 */
export function TableQrDialog({
  open,
  onOpenChange,
  restaurantName,
  table,
  qr,
  onRotated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly restaurantName: string;
  readonly table: TableQrDialogTable | null;
  readonly qr: TableQrCodeRow | null;
  readonly onRotated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRotation, setConfirmingRotation] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);

  const tableName = qr?.tableName ?? table?.name ?? "";
  // Both actions land in the same place: what a card should look like is one
  // decision, and it has to be made before either paper or a file exists.
  const printCards = useMemo(
    () => (qr ? [{ tableName, menuUrl: qr.menuUrl }] : []),
    [qr, tableName],
  );

  const rotate = useCallback(async () => {
    if (!table) return;
    setBusy(true);
    try {
      await adminApi.rotateTableToken(table.id);
      setConfirmingRotation(false);
      onRotated();
      toast.success("QR kodu yenilendi.", {
        description: qr?.revoked
          ? "Eski QR kodu artık kullanılamaz; menü durdurulmuş olarak kaldı."
          : "Eski QR kodu artık kullanılamaz.",
      });
    } catch (error) {
      toast.error(
        userErrorMessage(error, "QR kodu yenilenemedi."),
      );
    } finally {
      setBusy(false);
    }
  }, [onRotated, qr, table]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <WindowDialogContent
          size="sm"
          title={restaurantName}
          description={tableName}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={busy || !qr}
                onClick={() => setDesignerOpen(true)}
              >
                <Download /> QR İndir
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                disabled={busy || !qr}
                onClick={() => setDesignerOpen(true)}
              >
                <Printer /> Yazdır
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {qr ? (
              <>
                <div className="mx-auto w-full max-w-64 rounded-xl border border-gold/40 bg-[#FBF6EC] p-3">
                  <BrandedTableQr
                    menuUrl={qr.menuUrl}
                    title={`${tableName} QR menü kodu`}
                  />
                </div>
                <p className="text-center text-sm font-semibold">
                  Menüyü görüntülemek için QR kodunu okutun.
                </p>
                {qr.revoked ? (
                  <p className="rounded-xl bg-status-danger-tint px-3 py-2 text-center text-xs font-bold text-status-danger">
                    Bu masanın QR menüsü durduruldu. Yenileme erişimi açmaz; etkinleştirdiğinizde yalnız güncel QR çalışır.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="grid min-h-48 place-items-center text-center text-sm text-muted-foreground">
                QR kodu şu anda görüntülenemiyor.
              </p>
            )}

            <div className="border-t pt-3 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={busy || !table}
                onClick={() => setConfirmingRotation(true)}
              >
                <RefreshCw /> QR Kodunu Yenile
              </Button>
            </div>
          </div>
        </WindowDialogContent>
      </Dialog>

      <Dialog open={confirmingRotation} onOpenChange={setConfirmingRotation}>
        <WindowDialogContent
          size="sm"
          showCloseButton={false}
          title="QR kodunu yenilemek istiyor musunuz?"
          description="Mevcut basılı QR kodu artık çalışmayacaktır."
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingRotation(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void rotate()}
              >
                QR Kodunu Yenile
              </Button>
            </>
          }
        >
          <p className="text-sm leading-6 text-muted-foreground">
            {tableName} için yeni bir QR kodu üretilecek. Masadaki kartı yenisiyle
            değiştirmeniz gerekir.
          </p>
        </WindowDialogContent>
      </Dialog>

      <QrPrintDesigner
        open={designerOpen && printCards.length > 0}
        onOpenChange={setDesignerOpen}
        cards={printCards}
        restaurantName={restaurantName}
      />
    </>
  );
}
