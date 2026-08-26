"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CANCELLATION_NOTE_MAX_LENGTH,
  CANCELLATION_REASONS,
} from "@/lib/domain/order-mutations";
import { cn } from "@/lib/utils";

export interface CancellationSubmission {
  readonly reason: string;
  readonly reasonNote?: string;
}

/**
 * Shared reason picker for line and order cancellation. "Diğer" carries no
 * meaning on its own, so the server requires an explanation and so does this.
 */
export function CancellationReasonForm({
  title,
  description,
  confirmLabel = "İptali Onayla",
  reasons = CANCELLATION_REASONS,
  otherValue = "Diğer",
  labelFor,
  pending = false,
  onCancel,
  onSubmit,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Cancellation and void use different code lists; the server enum wins. */
  reasons?: readonly string[];
  otherValue?: string;
  labelFor?: (reason: string) => string;
  pending?: boolean;
  onCancel: () => void;
  onSubmit: (submission: CancellationSubmission) => void;
}) {
  const [reason, setReason] = useState<string>(reasons[0]!);
  const [note, setNote] = useState("");
  const explanationRequired = reason === otherValue;
  const blocked = pending || (explanationRequired && !note.trim());

  return (
    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
      <div>
        <h4 className="font-heading text-base font-semibold text-foreground">{title}</h4>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold text-foreground">İptal nedeni</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {reasons.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={reason === option}
              onClick={() => setReason(option)}
              className={cn(
                "min-h-11 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                reason === option
                  ? "border-burgundy bg-burgundy text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {labelFor?.(option) ?? option}
            </button>
          ))}
        </div>
      </fieldset>

      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={CANCELLATION_NOTE_MAX_LENGTH}
        rows={2}
        required={explanationRequired}
        aria-label="İptal açıklaması"
        placeholder={
          explanationRequired ? "Açıklama zorunlu" : "Açıklama (isteğe bağlı)"
        }
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          Vazgeç
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="min-h-11"
          disabled={blocked}
          aria-busy={pending}
          onClick={() =>
            onSubmit({ reason, reasonNote: note.trim() || undefined })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : null}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
