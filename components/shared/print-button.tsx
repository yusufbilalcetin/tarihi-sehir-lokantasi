"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api/client";
import { printApi } from "@/lib/api/endpoints";

/**
 * Sends one document to the thermal print queue.
 *
 * Queuing is all that happens here: the job is handed to the local agent out of
 * band, so a printer that is off, jammed or unplugged delays paper and never
 * touches the order, the payment or the shift. The toast says which of those
 * two things happened rather than claiming the paper came out.
 */
export function PrintButton({
  document,
  label,
  variant = "outline",
  className,
  disabled,
}: {
  readonly document: Parameters<typeof printApi.send>[0];
  readonly label: string;
  readonly variant?: "default" | "outline" | "secondary" | "ghost";
  readonly className?: string;
  readonly disabled?: boolean;
}) {
  const [sending, setSending] = useState(false);

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={disabled || sending}
      onClick={async () => {
        setSending(true);
        try {
          const result = await printApi.send(document);
          if (result.created.length > 0) {
            toast.success(`${label}: yazıcı kuyruğuna alındı.`);
          } else if (result.duplicates > 0) {
            toast.info(`${label}: bu belge zaten kuyrukta.`);
          } else {
            toast.warning(`${label}: tanımlı yazıcı yok.`);
          }
        } catch (error) {
          toast.error(
            error instanceof ApiClientError ? error.message : "Yazıcıya gönderilemedi.",
          );
        } finally {
          setSending(false);
        }
      }}
    >
      {sending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Printer className="size-4" strokeWidth={1.8} aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
