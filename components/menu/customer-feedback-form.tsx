"use client";

import { useState } from "react";
import { MessageSquareHeart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiResult } from "@/lib/api/response";

function Rating({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){return <div><p className="text-xs font-semibold text-muted-foreground">{label}</p><div className="mt-1 flex gap-1" role="group" aria-label={label}>{[1,2,3,4,5].map(score=><button key={score} type="button" onClick={()=>onChange(score)} aria-label={`${score} puan`} className={value>=score?"flex size-9 items-center justify-center rounded-lg bg-amber-400 text-sm font-bold text-amber-950":"flex size-9 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground"}>{score}</button>)}</div></div>}

export function CustomerFeedbackForm({ orderId }: { orderId: string }) {
  const [sent, setSent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState(5);
  const [food, setFood] = useState(5);
  const [service, setService] = useState(5);
  const [cleanliness, setCleanliness] = useState(5);
  const [comment, setComment] = useState("");

  if (sent) {
    return <div className="mt-5 rounded-2xl bg-status-success-tint p-4 text-sm font-semibold text-status-success">Geri bildiriminiz için teşekkür ederiz.</div>;
  }

  async function submit() {
    setSaving(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, rating, foodRating: food, serviceRating: service, cleanlinessRating: cleanliness, comment: comment || null }),
      });
      const payload = await response.json() as ApiResult<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.success ? "Geri bildirim gönderilemedi." : payload.error.message);
      setSent(true);
      toast.success("Geri bildiriminiz kaydedildi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Geri bildirim gönderilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-5 space-y-4 rounded-2xl border bg-background/60 p-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="flex items-center gap-2"><MessageSquareHeart className="size-5 text-burgundy"/><div><h3 className="font-semibold">Deneyiminiz nasıldı?</h3><p className="text-xs text-muted-foreground">Yorum isteğe bağlıdır; kimlik bilgisi istenmez.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><Rating label="Genel" value={rating} onChange={setRating}/><Rating label="Yemek" value={food} onChange={setFood}/><Rating label="Servis" value={service} onChange={setService}/><Rating label="Temizlik" value={cleanliness} onChange={setCleanliness}/></div>
      <Input value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="İsterseniz kısa bir yorum bırakın"/>
      <Button disabled={saving} className="w-full">{saving ? "Gönderiliyor…" : "Geri Bildirimi Gönder"}</Button>
    </form>
  );
}
