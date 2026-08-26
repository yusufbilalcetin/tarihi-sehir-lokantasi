"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock3 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiResult } from "@/lib/api/response";
import { useApiResource } from "@/lib/hooks/use-api-resource";

interface Attendance { id:string; clockInAt:string; clockOutAt:string|null; status:string }
interface Schedule { id:string; startsAt:string; endsAt:string; roleLabel:string|null; locationLabel:string|null; status:string }

async function read<T>(path:string,signal:AbortSignal):Promise<T>{const response=await fetch(path,{credentials:"same-origin",cache:"no-store",signal});const payload=await response.json() as ApiResult<T>;if(!response.ok||!payload.success)throw new Error(payload.success?"Bilgi alınamadı.":payload.error.message);return payload.data;}

export function StaffAttendanceCard(){
  const attendance=useApiResource(useCallback((signal:AbortSignal)=>read<Attendance|null>("/api/staff/attendance",signal),[]));
  const schedules=useApiResource(useCallback((signal:AbortSignal)=>read<Schedule[]>("/api/staff/schedule",signal),[]));
  const [now,setNow]=useState(()=>Date.now());const [saving,setSaving]=useState(false);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer)},[]);
  const current=attendance.data;const minutes=current?Math.max(0,Math.floor((now-new Date(current.clockInAt).getTime())/60_000)):0;
  async function toggle(){setSaving(true);try{const response=await fetch("/api/staff/attendance",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:current?"CLOCK_OUT":"CLOCK_IN"})});const payload=await response.json() as ApiResult<unknown>;if(!response.ok||!payload.success)throw new Error(payload.success?"Puantaj işlemi tamamlanamadı.":payload.error.message);toast.success(current?"Mesai bitişin kaydedildi.":"Mesai başlangıcın kaydedildi.");await attendance.refetch();}catch(error){toast.error(error instanceof Error?error.message:"Puantaj işlemi tamamlanamadı.");}finally{setSaving(false)}}
  return <section className="grid gap-4 lg:grid-cols-2" aria-label="Mesai ve vardiya"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-5 text-olive"/>Mesai</CardTitle><CardDescription>Kendi güncel mesai kaydın. Geçmiş zaman düzeltmelerini yönetici yapar.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><div>{current?<><p className="text-sm text-muted-foreground">Giriş: {new Intl.DateTimeFormat("tr-TR",{hour:"2-digit",minute:"2-digit"}).format(new Date(current.clockInAt))}</p><p className="mt-1 text-xl font-bold tabular-nums">Süre: {Math.floor(minutes/60)} sa {minutes%60} dk</p></>:<p className="text-sm text-muted-foreground">Şu anda açık mesain yok.</p>}</div><Button onClick={()=>void toggle()} disabled={saving} variant={current?"outline":"default"}>{current?"Mesaiyi Bitir":"Mesaiye Başla"}</Button></div></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5 text-olive"/>Yaklaşan vardiyalarım</CardTitle><CardDescription>Yalnızca sana atanmış yaklaşan vardiyalar.</CardDescription></CardHeader><CardContent>{schedules.data?.length?<div className="space-y-2">{schedules.data.slice(0,3).map(item=><div key={item.id} className="rounded-xl bg-muted/45 p-3 text-sm"><strong>{new Intl.DateTimeFormat("tr-TR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(item.startsAt))}</strong><span className="ml-2 text-muted-foreground">{item.roleLabel??"Görev"}{item.locationLabel?` · ${item.locationLabel}`:""}</span></div>)}</div>:<p className="text-sm text-muted-foreground">Yaklaşan vardiya ataman yok.</p>}</CardContent></Card></section>;
}
