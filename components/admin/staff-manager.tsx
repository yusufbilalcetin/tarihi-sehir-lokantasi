"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  KeyRound,
  Mail,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  AdminPageHeader,
  AdminPanel,
  DataToolbar,
  Field,
  NativeSelect,
  SummaryChip,
} from "@/components/admin/admin-ui";
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
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { ApiClientError } from "@/lib/api/client";
import { adminApi } from "@/lib/api/endpoints";
import { PANEL_ROLE_ACCESS } from "@/lib/auth/role-access";
import {
  STAFF_ROLE_LABELS,
  assignableRoles,
  canActOnRole,
  canManageStaff,
} from "@/lib/domain/staff-accounts";
import { USER_ROLES, type UserRole } from "@/lib/domain/status";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { getInitials } from "@/lib/format";

/**
 * Staff accounts.
 *
 * The panel never handles a password: creating an account sends its holder a
 * setup link, and the only password action here is asking for that link again.
 * The rules about who may touch whom come from the same module the server
 * enforces, so a disabled button and a 403 always agree.
 */

const PANEL_LABELS: Record<keyof typeof PANEL_ROLE_ACCESS, string> = {
  admin: "Yönetim paneli",
  staff: "Garson paneli",
  kitchen: "Mutfak ekranı",
  cashier: "Kasa paneli",
};

const PAGE_SIZE = 25;

function panelsForRole(role: UserRole): string[] {
  return (Object.keys(PANEL_ROLE_ACCESS) as (keyof typeof PANEL_ROLE_ACCESS)[])
    .filter((area) => (PANEL_ROLE_ACCESS[area] as readonly UserRole[]).includes(role))
    .map((area) => PANEL_LABELS[area]);
}

function moment(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function StaffManager() {
  const session = useStaffSession();
  const actorRole = session.role as UserRole;
  const canManage = canManageStaff(actorRole);
  const roleChoices = useMemo(() => assignableRoles(actorRole), [actorRole]);

  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | UserRole>("all");
  const [status, setStatus] = useState<"all" | "ACTIVE" | "INACTIVE">("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newIdentifier, setNewIdentifier] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("WAITER");

  const search = useMemo(() => {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (role !== "all") parameters.set("role", role);
    if (status !== "all") parameters.set("status", status);
    if (query.trim()) parameters.set("search", query.trim());
    return parameters.toString();
  }, [page, query, role, status]);
  const loadStaff = useCallback(
    (signal: AbortSignal) => adminApi.staff(search, signal),
    [search],
  );
  const resource = useApiResource(loadStaff);
  const { refetch } = resource;

  const staff = useMemo(() => resource.data?.staff ?? [], [resource.data]);
  const total = resource.data?.total ?? 0;
  const activeAdminCount = resource.data?.activeAdminCount ?? 0;
  const selected = staff.find((user) => user.id === selectedId) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** The last active administrator is protected in the UI and on the server. */
  function isLastAdmin(user: { role: UserRole; isActive: boolean; archived: boolean }): boolean {
    return user.role === "ADMIN" && user.isActive && !user.archived && activeAdminCount <= 1;
  }
  function isSelf(id: string): boolean {
    return id === session.staffId;
  }
  function mayEdit(user: { id: string; role: UserRole }): boolean {
    return canManage && canActOnRole(actorRole, user.role);
  }

  async function run(work: () => Promise<unknown>, successMessage: string): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      await work();
      await refetch();
      toast.success(successMessage);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeRole(id: string, nextRole: UserRole) {
    void run(() => adminApi.updateStaff(id, { role: nextRole }), "Personel rolü güncellendi.");
  }

  function setActive(id: string, isActive: boolean) {
    void run(
      () => adminApi.updateStaff(id, { isActive }),
      isActive ? "Personel hesabı etkinleştirildi." : "Personel hesabı pasife alındı.",
    );
  }

  function sendPasswordReset(id: string) {
    if (saving) return;
    setSaving(true);
    adminApi
      .requestStaffPasswordReset(id)
      .then((result) => {
        // Requested is not delivered; the operator is told which one happened.
        if (result.emailRequested) {
          toast.success("Şifre kurulum bağlantısı istendi.", {
            description: "Teslimat, Supabase e-posta yapılandırmasına bağlıdır.",
          });
        } else {
          toast.error("Bağlantı isteği sağlayıcı tarafından kabul edilmedi.", {
            description: "E-posta yapılandırmasını kontrol edin.",
          });
        }
      })
      .catch((error: unknown) =>
        toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı."),
      )
      .finally(() => setSaving(false));
  }

  function openNew() {
    setNewName("");
    setNewEmail("");
    setNewIdentifier("");
    setNewPhone("");
    setNewRole(roleChoices.includes("WAITER") ? "WAITER" : (roleChoices[0] ?? "WAITER"));
    setDialogOpen(true);
  }

  function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim() || !newEmail.trim()) {
      toast.error("Ad soyad ve e-posta girin.");
      return;
    }
    void run(async () => {
      const result = await adminApi.createStaff({
        name: newName.trim(),
        email: newEmail.trim(),
        role: newRole,
        ...(newPhone.trim() ? { phone: newPhone.trim() } : {}),
        ...(newIdentifier.trim() ? { loginIdentifier: newIdentifier.trim() } : {}),
      });
      setDialogOpen(false);
      // Requested is not delivered, and the difference is the operator's to know.
      toast.message(
        result.passwordSetupEmailRequested
          ? "Şifre kurulum bağlantısı istendi. Teslimat e-posta yapılandırmasına bağlıdır."
          : "Hesap oluşturuldu, ancak kurulum e-postası gönderilemedi. Panelden tekrar deneyin.",
      );
    }, "Personel hesabı oluşturuldu.");
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Personel"
        description="Çalışan hesaplarını, giriş yetkilerini ve rol bazlı panel erişimlerini yönetin."
        actions={
          canManage ? (
            <Button className="h-10" onClick={openNew}>
              <Plus /> Personel Ekle
            </Button>
          ) : null
        }
      />

      {actorRole === "MANAGER" ? (
        <p className="rounded-xl border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
          Müdür olarak garson, mutfak ve kasiyer hesaplarını yönetebilirsiniz. Yönetici ve
          müdür hesapları sistem yöneticisine aittir.
        </p>
      ) : null}

      {resource.error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive"
        >
          Personel listesi yüklenemedi: {resource.error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam" value={total} />
        <SummaryChip label="Aktif yönetici" value={activeAdminCount} />
        <SummaryChip
          label="Girişe bağlı"
          value={staff.filter((user) => user.linkedToAuth).length}
        />
      </div>

      <AdminPanel contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="h-10 bg-background pl-9"
              placeholder="Ad, e-posta veya kod ara"
              aria-label="Personel ara"
            />
          </div>
          <NativeSelect
            value={role}
            onChange={(event) => {
              setRole(event.target.value as "all" | UserRole);
              setPage(1);
            }}
            className="sm:w-48"
            aria-label="Rol filtresi"
          >
            <option value="all">Tüm roller</option>
            {USER_ROLES.map((option) => (
              <option key={option} value={option}>
                {STAFF_ROLE_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "all" | "ACTIVE" | "INACTIVE");
              setPage(1);
            }}
            className="sm:w-40"
            aria-label="Durum filtresi"
          >
            <option value="all">Tüm durumlar</option>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Pasif</option>
          </NativeSelect>
        </DataToolbar>

        {staff.length ? (
          <div className="divide-y">
            {staff.map((user) => {
              const active = user.isActive && !user.archived;
              const editable = mayEdit(user);
              const lastAdmin = isLastAdmin(user);
              return (
                <div
                  key={user.id}
                  className="grid items-center gap-4 p-4 transition-colors hover:bg-muted/20 sm:grid-cols-[minmax(0,1.3fr)_150px_150px_110px_auto] sm:px-5"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(user.id)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <Avatar size="lg">
                      <AvatarFallback className="bg-olive text-xs font-extrabold text-cream">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold">{user.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {user.email ?? "E-posta yok"}
                      </span>
                    </span>
                  </button>
                  <div>
                    <Badge variant="outline" className="bg-background">
                      {STAFF_ROLE_LABELS[user.role]}
                    </Badge>
                    {lastAdmin ? (
                      <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-status-warning">
                        <ShieldAlert className="size-3" aria-hidden="true" /> Son yönetici
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs">
                    <p className="font-bold">Son giriş</p>
                    <p className="mt-0.5 tabular-nums text-muted-foreground">
                      {moment(user.lastSignInAt)}
                    </p>
                  </div>
                  <div className="text-xs">
                    <Badge
                      variant="outline"
                      className={active ? "text-status-success" : "text-muted-foreground"}
                    >
                      {active ? "Aktif" : "Pasif"}
                    </Badge>
                    <p className="mt-1 tabular-nums text-muted-foreground">
                      {moment(user.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {editable && active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving || lastAdmin || isSelf(user.id)}
                        title={
                          lastAdmin
                            ? "Restoranın son aktif yöneticisi pasifleştirilemez."
                            : isSelf(user.id)
                              ? "Kendi hesabınızı pasifleştiremezsiniz."
                              : undefined
                        }
                        onClick={() => setConfirmDeactivate(user.id)}
                      >
                        Pasife Al
                      </Button>
                    ) : null}
                    {editable && !active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => setActive(user.id, true)}
                      >
                        Aktifleştir
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedId(user.id)}
                    >
                      <UserRoundCog /> Detay
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <UsersRound className="mx-auto size-9 text-muted-foreground" />
              <p className="mt-3 font-bold">
                {resource.loading ? "Personel yükleniyor…" : "Personel bulunamadı"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Arama metnini veya filtreleri değiştirin.
              </p>
            </div>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <p className="text-xs text-muted-foreground">
              Sayfa {page} / {pageCount} · {total} kayıt
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Önceki
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                Sonraki
              </Button>
            </div>
          </div>
        ) : null}
      </AdminPanel>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b px-5 py-5 pr-12">
                <div className="flex items-center gap-3">
                  <Avatar size="lg">
                    <AvatarFallback className="bg-olive font-extrabold text-cream">
                      {getInitials(selected.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle className="text-xl">{selected.name}</SheetTitle>
                    <SheetDescription>{STAFF_ROLE_LABELS[selected.role]}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="space-y-6 px-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border bg-background p-3">
                    <Mail className="size-4 text-burgundy" />
                    <p className="mt-2 text-xs text-muted-foreground">E-posta</p>
                    <p className="mt-1 truncate text-sm font-bold">{selected.email ?? "Tanımsız"}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-3">
                    <KeyRound className="size-4 text-burgundy" />
                    <p className="mt-2 text-xs text-muted-foreground">Son giriş</p>
                    <p className="mt-1 text-sm font-bold tabular-nums">
                      {moment(selected.lastSignInAt)}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-burgundy" />
                    <h3 className="font-heading text-lg font-semibold">Rol ve erişim</h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Erişim, sunucudaki rol matrisinden türetilir; ayrı izin listesi tutulmaz.
                  </p>
                  <div className="mt-3 space-y-3">
                    <Field label="Rol">
                      <NativeSelect
                        value={selected.role}
                        disabled={
                          !mayEdit(selected) ||
                          saving ||
                          isSelf(selected.id) ||
                          isLastAdmin(selected)
                        }
                        onChange={(event) =>
                          changeRole(selected.id, event.target.value as UserRole)
                        }
                      >
                        {roleChoices.map((option) => (
                          <option key={option} value={option}>
                            {STAFF_ROLE_LABELS[option]}
                          </option>
                        ))}
                        {roleChoices.includes(selected.role) ? null : (
                          <option value={selected.role}>{STAFF_ROLE_LABELS[selected.role]}</option>
                        )}
                      </NativeSelect>
                    </Field>
                    {isLastAdmin(selected) ? (
                      <p className="rounded-lg bg-status-warning-tint px-3 py-2 text-xs font-medium text-status-warning">
                        Bu, restoranın son aktif yöneticisi. Rolü düşürülemez ve pasife
                        alınamaz; önce başka bir yönetici tanımlayın.
                      </p>
                    ) : null}
                    <div className="rounded-2xl border bg-background p-3">
                      <p className="text-xs font-bold text-muted-foreground">
                        Erişebildiği ekranlar
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm font-semibold">
                        {panelsForRole(selected.role).map((panel) => (
                          <li key={panel}>• {panel}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-heading text-lg font-semibold">Şifre</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Şifreler Supabase Auth tarafından tutulur ve bu panelden görülemez.
                    Personel şifresini kendisi belirler.
                  </p>
                  <Button
                    className="mt-3 w-full"
                    variant="outline"
                    disabled={!mayEdit(selected) || saving || !selected.email}
                    onClick={() => sendPasswordReset(selected.id)}
                  >
                    <KeyRound /> Şifre Sıfırlama Bağlantısı Gönder
                  </Button>
                </div>
              </div>
              <SheetFooter className="sticky bottom-0 border-t bg-card">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={
                    !mayEdit(selected) ||
                    saving ||
                    isSelf(selected.id) ||
                    isLastAdmin(selected) ||
                    !selected.isActive
                  }
                  onClick={() => setConfirmDeactivate(selected.id)}
                >
                  Personeli Pasife Al
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Personeli pasife al</DialogTitle>
            <DialogDescription>
              Hesap silinmez: geçmiş siparişler, tahsilatlar ve vardiyalar bu kişiye bağlı
              kalır. Pasif hesap bir sonraki istekte giriş yapamaz ve panellere erişemez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeactivate(null)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                const id = confirmDeactivate;
                if (!id) return;
                setActive(id, false);
                setConfirmDeactivate(null);
                setSelectedId(null);
              }}
            >
              Pasife Al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={addStaff}>
            <DialogHeader>
              <DialogTitle className="text-xl">Yeni personel</DialogTitle>
              <DialogDescription>
                Giriş hesabı ve personel kaydı birlikte oluşturulur. Şifreyi personel,
                e-postasına gelen kurulum bağlantısıyla kendisi belirler.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              <Field label="Ad soyad" className="sm:col-span-2">
                <Input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className="h-10"
                  placeholder="Örn. Selin Aksoy"
                />
              </Field>
              <Field label="E-posta" className="sm:col-span-2">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  className="h-10"
                  placeholder="selin@ornek.com"
                  autoComplete="off"
                />
              </Field>
              <Field label="Rol">
                <NativeSelect
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value as UserRole)}
                >
                  {roleChoices.map((option) => (
                    <option key={option} value={option}>
                      {STAFF_ROLE_LABELS[option]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Giriş kodu" hint="İsteğe bağlı.">
                <Input
                  value={newIdentifier}
                  onChange={(event) => setNewIdentifier(event.target.value)}
                  className="h-10"
                  placeholder="1048"
                />
              </Field>
              <Field label="Telefon" className="sm:col-span-2">
                <Input
                  value={newPhone}
                  onChange={(event) => setNewPhone(event.target.value)}
                  className="h-10"
                  placeholder="05xx xxx xx xx"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving}>
                Personel Ekle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
