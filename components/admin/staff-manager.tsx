"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  CircleCheck,
  CirclePause,
  KeyRound,
  Mail,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  UserX,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  AdminFilterButton,
  AdminKpi,
  AdminPageHeader,
  AdminPanel,
  AdminSearchInput,
  AdminSegmentedControl,
  Field,
} from "@/components/admin/admin-ui";
import {
  AdminPagination,
  AdminStatusBadge,
  PersonnelActionMenu,
  PersonnelAvatar,
} from "@/components/admin/personnel-ui";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { userErrorMessage } from "@/lib/api/error-message";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      toast.error(userErrorMessage(error));
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
        toast.error(userErrorMessage(error)),
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
        title="Personel Listesi"
        description="Tüm personelinizi görüntüleyin ve yönetin."
        actions={
          canManage ? (
            <Button onClick={openNew}>
              <Plus aria-hidden="true" /> Personel Ekle
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

      {resource.data ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi label="Eşleşen Personel" value={total.toLocaleString("tr-TR")} icon={UsersRound} />
        <AdminKpi
          label="Bu Sayfada Aktif"
          value={staff.filter((user) => user.isActive && !user.archived).length.toLocaleString("tr-TR")}
          icon={CircleCheck}
          tone="success"
        />
        <AdminKpi
          label="Bu Sayfada Pasif"
          value={staff.filter((user) => !user.isActive || user.archived).length.toLocaleString("tr-TR")}
          icon={CirclePause}
          tone="warning"
        />
        <AdminKpi
          label="Giriş Hesabı Bağlı"
          value={staff.filter((user) => user.linkedToAuth).length.toLocaleString("tr-TR")}
          icon={UserCheck}
          helper="Görüntülenen sayfa"
          tone="info"
        />
      </div> : null}

      {resource.error && resource.data ? (
        <p role="alert" className="rounded-xl border border-status-warning/20 bg-status-warning-tint/45 px-4 py-3 text-sm">
          Liste yenilenemedi; son alınan veriler gösteriliyor. {resource.error.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AdminSegmentedControl
          label="Personel rolü"
          value={role}
          onValueChange={(nextRole) => {
            setRole(nextRole as "all" | UserRole);
            setPage(1);
          }}
          segments={[
            { value: "all", label: "Tümü" },
            ...USER_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABELS[value] })),
          ]}
        />
        <div className="flex flex-col gap-2 min-[430px]:flex-row">
          <AdminSearchInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Personel ara…"
            label="Personel ara"
            className="min-[430px]:w-64"
          />
          <AdminFilterButton
            onClick={() => setFiltersOpen((open) => !open)}
            activeCount={status === "all" ? 0 : 1}
          />
        </div>
      </div>

      {filtersOpen ? (
        <AdminPanel title="Filtreler" description="Listeyi gerçek hesap durumuna göre daraltın.">
          <div className="max-w-xs">
            <label className="grid gap-1.5 text-[13px] font-medium" htmlFor="staff-status-filter">
              Durum
              <Select
                items={{ all: "Tüm durumlar", ACTIVE: "Aktif", INACTIVE: "Pasif" }}
                value={status}
                onValueChange={(value) => {
                  setStatus((value ?? "all") as "all" | "ACTIVE" | "INACTIVE");
                  setPage(1);
                }}
              >
                <SelectTrigger id="staff-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm durumlar</SelectItem>
                  <SelectItem value="ACTIVE">Aktif</SelectItem>
                  <SelectItem value="INACTIVE">Pasif</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </AdminPanel>
      ) : null}

      {resource.error && !resource.data ? (
        <ErrorState
          title="Personel listesi yüklenemedi"
          description={resource.error.message}
          onRetry={() => void resource.refetch()}
        />
      ) : resource.loading && !resource.data ? (
        <LoadingState rows={6} />
      ) : staff.length ? (
        <AdminPanel contentClassName="p-0 sm:p-0">
          {/* `relative` anchors the action column's absolutely positioned
              `.sr-only` header inside the scroller; without it the span escaped
              to the initial containing block and pushed the document 33px wide
              at 768. */}
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/35 text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-medium">Personel</th>
                  <th scope="col" className="px-4 py-3 font-medium">Pozisyon</th>
                  <th scope="col" className="px-4 py-3 font-medium">Durum</th>
                  <th scope="col" className="px-4 py-3 font-medium">Son Giriş</th>
                  <th scope="col" className="px-4 py-3 font-medium">İşe Başlama</th>
                  <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">İşlemler</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
            {staff.map((user) => {
              const active = user.isActive && !user.archived;
              const editable = mayEdit(user);
              const lastAdmin = isLastAdmin(user);
              return (
                <tr key={user.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3.5">
                    <button type="button" onClick={() => setSelectedId(user.id)} className="flex min-w-0 items-center gap-3 text-left focus-visible:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                      <PersonnelAvatar name={user.name} size="lg" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground">{user.name}</span>
                        <span className="mt-0.5 block max-w-64 truncate text-xs text-muted-foreground">{user.email ?? user.loginIdentifier ?? "İkincil kimlik yok"}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-medium">{STAFF_ROLE_LABELS[user.role]}</span>
                    {lastAdmin ? (
                      <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-status-warning">
                        <ShieldAlert className="size-3" aria-hidden="true" /> Son yönetici
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5"><AdminStatusBadge label={active ? "Aktif" : "Pasif"} tone={active ? "success" : "neutral"} /></td>
                  <td className="px-4 py-3.5 text-xs tabular-nums text-muted-foreground">{moment(user.lastSignInAt)}</td>
                  <td className="px-4 py-3.5 text-xs tabular-nums text-muted-foreground">{moment(user.createdAt)}</td>
                  <td className="px-4 py-3.5 text-right">
                    <PersonnelActionMenu
                      label={`${user.name} işlemleri`}
                      actions={[
                        { label: "Detayları aç", icon: <UserRoundCog className="size-4" aria-hidden="true" />, onSelect: () => setSelectedId(user.id) },
                        ...(!active ? [{ label: "Aktifleştir", icon: <UserCheck className="size-4" aria-hidden="true" />, disabled: !editable || saving, onSelect: () => setActive(user.id, true) }] : []),
                        ...(active ? [{ label: "Pasife al", icon: <UserX className="size-4" aria-hidden="true" />, disabled: !editable || saving || lastAdmin || isSelf(user.id), danger: true, onSelect: () => setConfirmDeactivate(user.id) }] : []),
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {staff.map((user) => {
              const active = user.isActive && !user.archived;
              const editable = mayEdit(user);
              const lastAdmin = isLastAdmin(user);
              return (
                <article key={user.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <PersonnelAvatar name={user.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <button type="button" className="block max-w-full text-left" onClick={() => setSelectedId(user.id)}>
                        <span className="block truncate text-sm font-semibold">{user.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{user.email ?? user.loginIdentifier ?? "İkincil kimlik yok"}</span>
                      </button>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{STAFF_ROLE_LABELS[user.role]}</span>
                        <AdminStatusBadge label={active ? "Aktif" : "Pasif"} tone={active ? "success" : "neutral"} />
                      </div>
                    </div>
                    <PersonnelActionMenu
                      label={`${user.name} işlemleri`}
                      actions={[
                        { label: "Detayları aç", icon: <UserRoundCog className="size-4" aria-hidden="true" />, onSelect: () => setSelectedId(user.id) },
                        ...(!active ? [{ label: "Aktifleştir", icon: <UserCheck className="size-4" aria-hidden="true" />, disabled: !editable || saving, onSelect: () => setActive(user.id, true) }] : []),
                        ...(active ? [{ label: "Pasife al", icon: <UserX className="size-4" aria-hidden="true" />, disabled: !editable || saving || lastAdmin || isSelf(user.id), danger: true, onSelect: () => setConfirmDeactivate(user.id) }] : []),
                      ]}
                    />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs">
                    <div><dt className="text-muted-foreground">Son giriş</dt><dd className="mt-1 font-medium tabular-nums">{moment(user.lastSignInAt)}</dd></div>
                    <div><dt className="text-muted-foreground">İşe başlama</dt><dd className="mt-1 font-medium tabular-nums">{moment(user.createdAt)}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
          <AdminPagination page={page} totalPages={pageCount} total={total} onPageChange={setPage} />
        </AdminPanel>
      ) : (
        <EmptyState
          icon={UsersRound}
          title="Personel bulunamadı"
          description="Arama metnini veya filtreleri değiştirin."
          action={(query || role !== "all" || status !== "all") ? (
            <Button type="button" variant="outline" onClick={() => { setQuery(""); setRole("all"); setStatus("all"); setPage(1); }}>Filtreleri temizle</Button>
          ) : undefined}
        />
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b px-5 py-5 pr-12">
                <div className="flex items-center gap-3">
                  <PersonnelAvatar name={selected.name} size="lg" />
                  <div>
                    <SheetTitle className="text-xl">{selected.name}</SheetTitle>
                    <SheetDescription>{STAFF_ROLE_LABELS[selected.role]}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="space-y-6 px-5">
                <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                  <div className="rounded-xl border bg-background p-3">
                    <Mail className="size-4 text-muted-foreground" />
                    <p className="mt-2 text-xs text-muted-foreground">E-posta</p>
                    <p className="mt-1 truncate text-sm font-bold">{selected.email ?? "Tanımsız"}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-3">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <p className="mt-2 text-xs text-muted-foreground">Son giriş</p>
                    <p className="mt-1 text-sm font-bold tabular-nums">
                      {moment(selected.lastSignInAt)}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-muted-foreground" />
                    <h3 className="font-heading text-lg font-semibold">Rol ve erişim</h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Erişim, sunucudaki rol matrisinden türetilir; ayrı izin listesi tutulmaz.
                  </p>
                  <div className="mt-3 space-y-3">
                    <Field label="Rol">
                      <Select
                        items={Object.fromEntries(roleChoices.map((option) => [option, STAFF_ROLE_LABELS[option]]))}
                        value={selected.role}
                        disabled={
                          !mayEdit(selected) ||
                          saving ||
                          isSelf(selected.id) ||
                          isLastAdmin(selected)
                        }
                        onValueChange={(value) => value && changeRole(selected.id, value as UserRole)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {roleChoices.map((option) => <SelectItem key={option} value={option}>{STAFF_ROLE_LABELS[option]}</SelectItem>)}
                          {roleChoices.includes(selected.role) ? null : <SelectItem value={selected.role}>{STAFF_ROLE_LABELS[selected.role]}</SelectItem>}
                        </SelectContent>
                      </Select>
                    </Field>
                    {isLastAdmin(selected) ? (
                      <p className="rounded-lg bg-status-warning-tint px-3 py-2 text-xs font-medium text-status-warning">
                        Bu, restoranın son aktif yöneticisi. Rolü düşürülemez ve pasife
                        alınamaz; önce başka bir yönetici tanımlayın.
                      </p>
                    ) : null}
                    <div className="rounded-xl border bg-background p-3">
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
        <WindowDialogContent
          size="sm"
          title="Personeli pasife al"
          description="Hesap silinmez: geçmiş siparişler, tahsilatlar ve vardiyalar bu kişiye bağlı kalır."
          footer={
            <>
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
            </>
          }
        >
          <p className="text-sm leading-6 text-muted-foreground">
            Pasif hesap bir sonraki istekte giriş yapamaz ve panellere erişemez.
          </p>
        </WindowDialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <WindowDialogContent
          size="sm"
          title="Yeni personel"
          description="Giriş hesabı ve personel kaydı birlikte oluşturulur. Şifreyi personel, e-postasına gelen kurulum bağlantısıyla kendisi belirler."
          render={<form onSubmit={addStaff} />}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving}>
                Personel Ekle
              </Button>
            </>
          }
        >
            <div className="grid gap-4 sm:grid-cols-2">
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
                <Select
                  items={Object.fromEntries(roleChoices.map((option) => [option, STAFF_ROLE_LABELS[option]]))}
                  value={newRole}
                  onValueChange={(value) => value && setNewRole(value as UserRole)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleChoices.map((option) => <SelectItem key={option} value={option}>{STAFF_ROLE_LABELS[option]}</SelectItem>)}
                  </SelectContent>
                </Select>
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
        </WindowDialogContent>
      </Dialog>
    </div>
  );
}
