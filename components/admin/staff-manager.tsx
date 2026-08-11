"use client";

import { useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, KeyRound, Phone, Plus, Search, ShieldCheck, UserRoundCog, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel, DataToolbar, Field, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { staffUsers as initialStaff } from "@/lib/mock-data";
import { getInitials } from "@/lib/format";
import type { StaffPermission, StaffRole, StaffUser } from "@/types";

const permissions: StaffPermission[] = [
  "Sipariş görüntüle",
  "Sipariş ekle",
  "Sipariş iptal",
  "Tükendi işaretle",
  "İndirim uygula",
  "Menü düzenle",
  "Rapor görüntüle",
];

const roleOptions: { value: StaffRole; label: string }[] = [
  { value: "ADMIN", label: "Yönetici" },
  { value: "Garson", label: "Garson" },
  { value: "Şef Garson", label: "Şef Garson" },
  { value: "Mutfak", label: "Mutfak" },
  { value: "Kasa", label: "Kasa" },
];

function getRoleLabel(role: StaffRole): string {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

export function StaffManager() {
  const [staff, setStaff] = useState<StaffUser[]>(initialStaff);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | StaffRole>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("Garson");

  const selected = staff.find((user) => user.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return staff.filter((user) => {
      const matches = !normalized || user.name.toLocaleLowerCase("tr-TR").includes(normalized) || user.code.includes(normalized);
      return matches && (role === "all" || user.role === role);
    });
  }, [staff, query, role]);

  function togglePermission(permission: StaffPermission, checked: boolean) {
    if (!selectedId) return;
    setStaff((current) => current.map((user) => {
      if (user.id !== selectedId) return user;
      const next = checked ? [...new Set([...user.permissions, permission])] : user.permissions.filter((item) => item !== permission);
      return { ...user, permissions: next };
    }));
  }

  function toggleActive(id: string, checked: boolean) {
    setStaff((current) => current.map((user) => user.id === id ? { ...user, active: checked } : user));
    toast.success(checked ? "Personel hesabı etkinleştirildi." : "Personel hesabı pasife alındı.");
  }

  function openNew() {
    setNewName("");
    setNewCode("");
    setNewPhone("");
    setNewRole("Garson");
    setDialogOpen(true);
  }

  function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim() || !newCode.trim()) {
      toast.error("Ad soyad ve personel kodunu girin.");
      return;
    }
    setStaff((current) => [...current, { id: `staff-${Date.now()}`, name: newName.trim(), code: newCode.trim(), role: newRole, roleLabel: getRoleLabel(newRole), active: true, phone: newPhone.trim() || "Belirtilmedi", shift: "10:00 - 18:00", permissions: ["Sipariş görüntüle"] }]);
    setDialogOpen(false);
    toast.success("Personel demo listesine eklendi.");
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Personel"
        description="Çalışan hesaplarını, vardiya bilgilerini ve rol bazlı erişim izinlerini yönetin."
        actions={<Button className="h-10" onClick={openNew}><Plus /> Personel Ekle</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam" value={staff.length} />
        <SummaryChip label="Aktif" value={staff.filter((user) => user.active).length} />
        <SummaryChip label="Garson ekibi" value={staff.filter((user) => ["Garson", "Şef Garson"].includes(user.role)).length} />
      </div>

      <AdminPanel contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-background pl-9" placeholder="Ad veya personel kodu ara" aria-label="Personel ara" />
          </div>
          <NativeSelect value={role} onChange={(event) => setRole(event.target.value as "all" | StaffRole)} className="sm:w-48" aria-label="Rol filtresi">
            <option value="all">Tüm roller</option>
            {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </NativeSelect>
        </DataToolbar>

        {filtered.length ? (
          <div className="divide-y">
            {filtered.map((user) => (
              <div key={user.id} className="grid items-center gap-4 p-4 transition-colors hover:bg-muted/20 sm:grid-cols-[minmax(0,1.3fr)_140px_170px_110px_auto] sm:px-5">
                <button type="button" onClick={() => setSelectedId(user.id)} className="flex min-w-0 items-center gap-3 text-left">
                  <Avatar size="lg"><AvatarFallback className="bg-olive text-xs font-extrabold text-cream">{getInitials(user.name)}</AvatarFallback></Avatar>
                  <span className="min-w-0"><span className="block truncate text-sm font-extrabold">{user.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">Kod: {user.code}</span></span>
                </button>
                <div><Badge variant="outline" className="bg-background">{user.roleLabel}</Badge></div>
                <div className="text-xs"><p className="font-bold">{user.shift}</p><p className="mt-1 truncate text-muted-foreground">{user.phone}</p></div>
                <label className="flex items-center gap-2 text-xs font-bold"><Switch checked={user.active} onCheckedChange={(checked) => toggleActive(user.id, checked)} aria-label={`${user.name} aktiflik durumu`} /> {user.active ? "Aktif" : "Pasif"}</label>
                <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setSelectedId(user.id)}><UserRoundCog /> Yetkiler</Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><UsersRound className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Personel bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Arama metnini veya rol filtresini değiştirin.</p></div></div>
        )}
      </AdminPanel>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b px-5 py-5 pr-12">
                <div className="flex items-center gap-3">
                  <Avatar size="lg"><AvatarFallback className="bg-olive font-extrabold text-cream">{getInitials(selected.name)}</AvatarFallback></Avatar>
                  <div><SheetTitle className="text-xl">{selected.name}</SheetTitle><SheetDescription>{selected.roleLabel}, personel kodu {selected.code}</SheetDescription></div>
                </div>
              </SheetHeader>
              <div className="space-y-6 px-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-background p-3"><Phone className="size-4 text-burgundy" /><p className="mt-2 text-xs text-muted-foreground">Telefon</p><p className="mt-1 text-sm font-bold">{selected.phone}</p></div>
                  <div className="rounded-xl border bg-background p-3"><KeyRound className="size-4 text-burgundy" /><p className="mt-2 text-xs text-muted-foreground">Vardiya</p><p className="mt-1 text-sm font-bold">{selected.shift}</p></div>
                </div>
                <div>
                  <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-burgundy" /><h3 className="font-heading text-lg font-semibold">Erişim izinleri</h3></div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Bu izinler demo oturumu boyunca değişir.</p>
                  <div className="mt-3 rounded-2xl border bg-background p-2">
                    {permissions.map((permission) => {
                      const checked = selected.permissions.includes(permission);
                      return (
                        <label key={permission} className="flex min-h-12 items-center justify-between gap-4 rounded-xl px-3 hover:bg-muted/40">
                          <span className="flex items-center gap-2 text-sm font-semibold">{checked ? <BadgeCheck className="size-4 text-emerald-700" /> : <span className="size-4" />}{permission}</span>
                          <Switch checked={checked} onCheckedChange={(next) => togglePermission(permission, next)} aria-label={`${permission} izni`} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <SheetFooter className="sticky bottom-0 border-t bg-card"><Button className="w-full" onClick={() => toast.success("Personel izinleri kaydedildi.")}><ShieldCheck /> İzinleri Kaydet</Button></SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={addStaff}>
            <DialogHeader><DialogTitle className="text-xl">Personel ekle</DialogTitle><DialogDescription>Demo hesaba ait temel kimlik ve rol bilgilerini girin.</DialogDescription></DialogHeader>
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              <Field label="Ad soyad" className="sm:col-span-2"><Input value={newName} onChange={(event) => setNewName(event.target.value)} className="h-10" placeholder="Örn. Selin Aksoy" /></Field>
              <Field label="Personel kodu"><Input value={newCode} onChange={(event) => setNewCode(event.target.value)} className="h-10" placeholder="1048" /></Field>
              <Field label="Rol"><NativeSelect value={newRole} onChange={(event) => setNewRole(event.target.value as StaffRole)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></Field>
              <Field label="Telefon" className="sm:col-span-2"><Input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} className="h-10" placeholder="05xx xxx xx xx" /></Field>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button><Button type="submit">Personel Ekle</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
