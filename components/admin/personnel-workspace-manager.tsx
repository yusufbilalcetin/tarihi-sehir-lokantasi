"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  FilePenLine,
  Plus,
  ReceiptText,
  RefreshCw,
  TimerReset,
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
  type PersonnelStatusTone,
} from "@/components/admin/personnel-ui";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import type { ApiResult } from "@/lib/api/response";
import { erpEnumLabel } from "@/lib/domain/erp-workspaces";
import type { ErpWorkspaceData, ErpWorkspaceModule } from "@/lib/domain/erp-workspaces";
import { formatElapsed } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

type PersonnelModule = Extract<ErpWorkspaceModule, "attendance" | "schedules" | "payroll">;
type Row = Record<string, unknown>;
type Option = Record<string, string> & { value: string; label: string };

const PAGE_SIZE = 25;
const WEEK_PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

const PERSONNEL_COPY: Record<PersonnelModule, { title: string; description: string }> = {
  attendance: { title: "Puantaj", description: "Personel giriş-çıkış ve çalışma saatlerini takip edin." },
  schedules: { title: "Vardiya Planı", description: "Haftalık personel vardiyalarını planlayın ve yönetin." },
  payroll: { title: "Bordro", description: "Personel bordrolarını ve ödeme durumlarını yönetin." },
};

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, amount: number): string {
  return localDateKey(new Date(dateFromKey(value).getTime() + amount * DAY_MS));
}

function weekStart(value = localDateKey()): string {
  const date = dateFromKey(value);
  const offset = (date.getDay() + 6) % 7;
  return addDays(value, -offset);
}

function rangeFor(view: "today" | "week" | "month") {
  const today = localDateKey();
  if (view === "today") return { from: today, to: today };
  if (view === "week") {
    const from = weekStart(today);
    return { from, to: addDays(from, 6) };
  }
  const date = dateFromKey(today);
  const from = localDateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const to = localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
  return { from, to };
}

function shortDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value).length === 10 ? `${String(value)}T12:00:00` : String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function time(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number.isFinite(number) ? number : 0);
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function statusTone(status: string): PersonnelStatusTone {
  if (["OPEN", "CONFIRMED", "APPROVED", "PAID", "COMPLETED"].includes(status)) return "success";
  if (["PLANNED", "DRAFT", "CORRECTED"].includes(status)) return "info";
  if (status === "CANCELLED") return "danger";
  return "neutral";
}

function Status({ value }: { value: unknown }) {
  const status = String(value ?? "");
  return <AdminStatusBadge label={erpEnumLabel(status) ?? "Tanımsız"} tone={statusTone(status)} />;
}

function useWorkspace(module: PersonnelModule, parameters: URLSearchParams) {
  const query = parameters.toString();
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/admin/erp/${module}?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    const payload = await response.json() as ApiResult<ErpWorkspaceData>;
    if (!response.ok || !payload.success) {
      throw new Error(payload.success ? "Veriler alınamadı." : payload.error.message);
    }
    return payload.data;
  }, [module, query]);
  return useApiResource(load);
}

async function sendCommand(endpoint: "/api/admin/erp" | `/api/admin/erp/${PersonnelModule}`, body: Row) {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as ApiResult<unknown>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? "İşlem tamamlanamadı." : payload.error.message);
  }
}

function WorkspaceState({
  module,
  data,
  loading,
  error,
  filtered,
  onRetry,
  children,
}: {
  module: PersonnelModule;
  data: ErpWorkspaceData | null;
  loading: boolean;
  error: Error | null;
  filtered: boolean;
  onRetry: () => void;
  children: (data: ErpWorkspaceData) => React.ReactNode;
}) {
  if (error && !data) return <ErrorState title={`${PERSONNEL_COPY[module].title} yüklenemedi`} description={error.message} onRetry={onRetry} />;
  if (loading && !data) return <LoadingState rows={6} />;
  if (!data) return null;
  if (!data.rows.length) {
    return (
      <EmptyState
        icon={module === "attendance" ? CalendarCheck : module === "schedules" ? CalendarClock : ReceiptText}
        title={module === "attendance" ? "Puantaj kaydı bulunamadı" : module === "schedules" ? "Bu haftada vardiya yok" : "Bordro kaydı bulunamadı"}
        description={filtered ? "Arama metnini veya filtreleri değiştirin." : "Henüz görüntülenecek bir kayıt yok."}
      />
    );
  }
  return <>{children(data)}</>;
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-medium" htmlFor={id}>
      {label}
      <Select items={Object.fromEntries(options.map((option) => [option.value, option.label]))} value={value} onValueChange={(next) => onChange(next ?? options[0]?.value ?? "")}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}

function AttendanceCorrectionDialog({
  open,
  onOpenChange,
  rows,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly Row[];
  onDone: () => Promise<void>;
}) {
  const [recordId, setRecordId] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const options = rows.map((row) => ({ value: String(row.id), label: `${String(row.staff ?? "Personel")} · ${shortDate(row.business_date)}` }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clockInAt = dateTimeLocalToIso(clockIn);
    if (!recordId || !clockInAt) return;
    setSaving(true);
    try {
      await sendCommand("/api/admin/erp/attendance", {
        command: "CORRECT_ATTENDANCE",
        attendanceRecordId: recordId,
        clockInAt,
        clockOutAt: dateTimeLocalToIso(clockOut),
        breakMinutes: Number(breakMinutes),
        reason,
      });
      toast.success("Puantaj kaydı düzeltildi.");
      onOpenChange(false);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WindowDialogContent
        title="Puantaj düzeltmesi"
        description="Önceki ve yeni değerler değişiklik geçmişine yazılır; gerekçe zorunludur."
        size="md"
        render={<form onSubmit={submit} />}
        footer={<><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button><Button type="submit" disabled={saving}>Düzeltmeyi Kaydet</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Puantaj kaydı" className="sm:col-span-2">
            <Select items={Object.fromEntries(options.map((option) => [option.value, option.label]))} value={recordId} onValueChange={(value) => setRecordId(value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Kayıt seçin" /></SelectTrigger>
              <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Yeni giriş"><Input type="datetime-local" required value={clockIn} onChange={(event) => setClockIn(event.target.value)} /></Field>
          <Field label="Yeni çıkış"><Input type="datetime-local" value={clockOut} onChange={(event) => setClockOut(event.target.value)} /></Field>
          <Field label="Mola (dk)"><Input type="number" min={0} max={1440} required value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></Field>
          <Field label="Düzeltme gerekçesi" className="sm:col-span-2"><Input required minLength={5} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        </div>
      </WindowDialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ open, onOpenChange, staff, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; staff: readonly Option[]; onDone: () => Promise<void> }) {
  const [staffId, setStaffId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = dateTimeLocalToIso(startsAt);
    const end = dateTimeLocalToIso(endsAt);
    if (!staffId || !start || !end) return;
    setSaving(true);
    try {
      await sendCommand("/api/admin/erp", { command: "CREATE_SCHEDULE", staffId, startsAt: start, endsAt: end, roleLabel: roleLabel || null, locationLabel: locationLabel || null, notes: notes || null });
      toast.success("Vardiya planlandı.");
      onOpenChange(false);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WindowDialogContent
        title="Yeni vardiya"
        description="Aynı personelin çakışan vardiyası kayıtta engellenir."
        size="md"
        render={<form onSubmit={submit} />}
        footer={<><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button><Button type="submit" disabled={saving}>Vardiyayı Kaydet</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Personel" className="sm:col-span-2">
            <Select items={Object.fromEntries(staff.map((option) => [option.value, option.label]))} value={staffId} onValueChange={(value) => setStaffId(value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Personel seçin" /></SelectTrigger>
              <SelectContent>{staff.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Başlangıç"><Input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
          <Field label="Bitiş"><Input type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
          <Field label="Görev"><Input maxLength={80} value={roleLabel} onChange={(event) => setRoleLabel(event.target.value)} /></Field>
          <Field label="Konum"><Input maxLength={120} value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} /></Field>
          <Field label="Not" className="sm:col-span-2"><Input maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      </WindowDialogContent>
    </Dialog>
  );
}

function PayrollDialog({ open, onOpenChange, staff, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; staff: readonly Option[]; onDone: () => Promise<void> }) {
  const [values, setValues] = useState({ staffId: "", periodStart: "", periodEnd: "", workedMinutes: "0", overtimeMinutes: "0", grossSalary: "", allowances: "0", deductions: "0" });
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await sendCommand("/api/admin/erp/payroll", { command: "UPSERT_PAYROLL", staffId: values.staffId, periodStart: values.periodStart, periodEnd: values.periodEnd, workedMinutes: Number(values.workedMinutes), overtimeMinutes: Number(values.overtimeMinutes), grossSalary: values.grossSalary, allowances: values.allowances, deductions: values.deductions, status: "DRAFT", correctionReason: null });
      toast.success("Operasyonel bordro kaydı kaydedildi.");
      onOpenChange(false);
      await onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WindowDialogContent
        title="Bordro kaydı"
        description="Bu kayıt SGK veya vergi hesabı yapmaz; girilen operasyonel tutarların netini hesaplar."
        size="lg"
        render={<form onSubmit={submit} />}
        footer={<><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button><Button type="submit" disabled={saving}>Kaydet</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Personel" className="sm:col-span-2">
            <Select items={Object.fromEntries(staff.map((option) => [option.value, option.label]))} value={values.staffId} onValueChange={(value) => update("staffId", value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Personel seçin" /></SelectTrigger>
              <SelectContent>{staff.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Dönem başlangıç"><Input type="date" required value={values.periodStart} onChange={(event) => update("periodStart", event.target.value)} /></Field>
          <Field label="Dönem sonu"><Input type="date" required value={values.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} /></Field>
          <Field label="Çalışma (dk)"><Input type="number" min={0} required value={values.workedMinutes} onChange={(event) => update("workedMinutes", event.target.value)} /></Field>
          <Field label="Fazla mesai (dk)"><Input type="number" min={0} required value={values.overtimeMinutes} onChange={(event) => update("overtimeMinutes", event.target.value)} /></Field>
          <Field label="Brüt maaş"><Input inputMode="decimal" required value={values.grossSalary} onChange={(event) => update("grossSalary", event.target.value)} /></Field>
          <Field label="Ek ödemeler"><Input inputMode="decimal" required value={values.allowances} onChange={(event) => update("allowances", event.target.value)} /></Field>
          <Field label="Kesintiler"><Input inputMode="decimal" required value={values.deductions} onChange={(event) => update("deductions", event.target.value)} /></Field>
        </div>
      </WindowDialogContent>
    </Dialog>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-status-warning/20 bg-status-warning-tint/45 px-4 py-3 text-[13px] leading-5 text-foreground">{children}</p>;
}

function AttendanceWorkspace() {
  const [view, setView] = useState<"today" | "week" | "month">("today");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const range = rangeFor(view);
  const parameters = useMemo(() => new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search, status: status === "all" ? "" : status, dateFrom: range.from, dateTo: range.to }), [page, range.from, range.to, search, status]);
  const resource = useWorkspace("attendance", parameters);
  const rows = resource.data?.rows ?? [];
  const totalMinutes = rows.reduce((sum, row) => sum + numberValue(row.duration_minutes), 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={PERSONNEL_COPY.attendance.title}
        description={PERSONNEL_COPY.attendance.description}
        actions={
          <>
            <Button
              nativeButton={false}
              variant="outline"
              render={<a href={`/api/admin/erp/export/attendance?${parameters}`} download />}
            >
              <Download aria-hidden="true" /> CSV
            </Button>
            <Button variant="outline" onClick={() => void resource.refetch()} disabled={resource.refreshing}>
              <RefreshCw className={resource.refreshing ? "animate-spin" : undefined} aria-hidden="true" /> Yenile
            </Button>
            {/* Disabled says "not now"; it has to also say why. A correction
                names an existing puantaj record, so with nothing listed there
                is nothing to correct — the title carries that reason instead
                of leaving a grey button with no account of itself. */}
            <Button
              variant="outline"
              onClick={() => setCorrectionOpen(true)}
              disabled={!rows.length}
              title={rows.length ? undefined : "Düzeltilecek puantaj kaydı yok. Önce bir dönem veya filtre seçin."}
            >
              <FilePenLine aria-hidden="true" /> Düzeltme
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi label="Puantaj Kaydı" value={(resource.data?.pagination.total ?? 0).toLocaleString("tr-TR")} icon={CalendarCheck} />
        <AdminKpi label="Şu An Çalışan" value={rows.filter((row) => row.status === "OPEN").length.toLocaleString("tr-TR")} icon={UsersRound} tone="success" helper="Görüntülenen dönem" />
        <AdminKpi label="Tamamlanan" value={rows.filter((row) => ["COMPLETED", "CORRECTED"].includes(String(row.status))).length.toLocaleString("tr-TR")} icon={CheckCircle2} tone="info" helper="Görüntülenen dönem" />
        <AdminKpi label="Toplam Çalışma" value={formatElapsed(totalMinutes)} icon={Clock3} helper="Görüntülenen kayıtlar" />
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AdminSegmentedControl label="Puantaj dönemi" value={view} onValueChange={(value) => { setView(value as typeof view); setPage(1); }} segments={[{ value: "today", label: "Bugün" }, { value: "week", label: "Haftalık" }, { value: "month", label: "Aylık" }]} />
        <div className="flex flex-col gap-2 min-[430px]:flex-row"><AdminSearchInput value={search} onValueChange={(value) => { setSearch(value); setPage(1); }} placeholder="Personel ara…" label="Puantajda personel ara" /><AdminFilterButton activeCount={status === "all" ? 0 : 1} onClick={() => setFiltersOpen((open) => !open)} /></div>
      </div>
      {filtersOpen ? <AdminPanel title="Filtreler"><div className="max-w-xs"><FilterSelect id="attendance-status" label="Durum" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Tüm durumlar" }, { value: "OPEN", label: "Çalışıyor" }, { value: "COMPLETED", label: "Tamamlandı" }, { value: "CORRECTED", label: "Düzeltildi" }]} /></div></AdminPanel> : null}
      <WorkspaceState module="attendance" data={resource.data} loading={resource.loading} error={resource.error} filtered={Boolean(search || status !== "all")} onRetry={() => void resource.refetch()}>
        {(data) => <AttendanceTable data={data} page={page} onPageChange={setPage} />}
      </WorkspaceState>
      <AttendanceCorrectionDialog open={correctionOpen} onOpenChange={setCorrectionOpen} rows={rows} onDone={resource.refetch} />
    </div>
  );
}

function AttendanceTable({ data, page, onPageChange }: { data: ErpWorkspaceData; page: number; onPageChange: (page: number) => void }) {
  return (
    <AdminPanel contentClassName="p-0 sm:p-0">
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-border bg-muted/35 text-xs text-muted-foreground"><th scope="col" className="px-5 py-3 font-medium">Personel</th><th scope="col" className="px-4 py-3 font-medium">İş Günü</th><th scope="col" className="px-4 py-3 font-medium">Giriş</th><th scope="col" className="px-4 py-3 font-medium">Çıkış</th><th scope="col" className="px-4 py-3 font-medium">Çalışma Süresi</th><th scope="col" className="px-4 py-3 font-medium">Durum</th></tr></thead><tbody className="divide-y divide-border">{data.rows.map((row) => <tr key={String(row.id)} className="hover:bg-muted/20"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><PersonnelAvatar name={String(row.staff)} /><span className="font-semibold">{String(row.staff)}</span></div></td><td className="px-4 py-3.5 text-muted-foreground">{shortDate(row.business_date)}</td><td className="px-4 py-3.5 font-medium tabular-nums">{time(row.clock_in_at)}</td><td className="px-4 py-3.5 font-medium tabular-nums">{time(row.clock_out_at)}</td><td className="px-4 py-3.5 tabular-nums">{row.duration_minutes == null ? "—" : formatElapsed(numberValue(row.duration_minutes))}</td><td className="px-4 py-3.5"><Status value={row.status} /></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-border md:hidden">{data.rows.map((row) => <article key={String(row.id)} className="p-4"><div className="flex items-start gap-3"><PersonnelAvatar name={String(row.staff)} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{String(row.staff)}</p><p className="mt-0.5 text-xs text-muted-foreground">{shortDate(row.business_date)}</p></div><Status value={row.status} /></div><dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/45 p-3 text-xs"><div><dt className="text-muted-foreground">Giriş</dt><dd className="mt-1 font-semibold tabular-nums">{time(row.clock_in_at)}</dd></div><div><dt className="text-muted-foreground">Çıkış</dt><dd className="mt-1 font-semibold tabular-nums">{time(row.clock_out_at)}</dd></div><div><dt className="text-muted-foreground">Süre</dt><dd className="mt-1 font-semibold tabular-nums">{row.duration_minutes == null ? "—" : formatElapsed(numberValue(row.duration_minutes))}</dd></div></dl></article>)}</div>
      <AdminPagination page={page} totalPages={data.pagination.totalPages} total={data.pagination.total} onPageChange={onPageChange} />
    </AdminPanel>
  );
}

const DAY_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const;
const SHIFT_TONES = ["border-status-info/20 bg-status-info-tint/65", "border-status-success/20 bg-status-success-tint/60", "border-status-warning/20 bg-status-warning-tint/55", "border-border-strong bg-muted/65"] as const;

function shiftColor(row: Row): string {
  const text = String(row.role_label ?? row.location_label ?? row.staff ?? "");
  const score = [...text].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return SHIFT_TONES[score % SHIFT_TONES.length] ?? SHIFT_TONES[0];
}

function ScheduleWorkspace() {
  const [start, setStart] = useState(weekStart());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const parameters = useMemo(() => new URLSearchParams({ page: "1", pageSize: String(WEEK_PAGE_SIZE), search, status: status === "all" ? "" : status, dateFrom: start, dateTo: addDays(start, 6) }), [search, start, status]);
  const resource = useWorkspace("schedules", parameters);
  const rows = resource.data?.rows ?? [];
  const uniqueStaff = new Set(rows.map((row) => String(row.staff))).size;
  const totalHours = rows.reduce((sum, row) => sum + Math.max(0, (new Date(String(row.ends_at)).getTime() - new Date(String(row.starts_at)).getTime()) / 3_600_000), 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader title={PERSONNEL_COPY.schedules.title} description={PERSONNEL_COPY.schedules.description} actions={<><Button variant="outline" onClick={() => void resource.refetch()} disabled={resource.refreshing}><RefreshCw className={resource.refreshing ? "animate-spin" : undefined} aria-hidden="true" /> Yenile</Button><Button onClick={() => setDialogOpen(true)}><Plus aria-hidden="true" /> Vardiya Ekle</Button></>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><AdminKpi label="Planlanan Vardiya" value={(resource.data?.pagination.total ?? 0).toLocaleString("tr-TR")} icon={CalendarClock} /><AdminKpi label="Planlı Personel" value={uniqueStaff.toLocaleString("tr-TR")} icon={UsersRound} tone="success" /><AdminKpi label="Onaylanan" value={rows.filter((row) => row.status === "CONFIRMED").length.toLocaleString("tr-TR")} icon={CheckCircle2} tone="info" /><AdminKpi label="Toplam Süre" value={`${totalHours.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sa`} icon={Clock3} helper="Görüntülenen hafta" /></div>
      <AdminPanel contentClassName="p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setStart(addDays(start, -7))}>Önceki</Button><p className="min-w-0 text-center text-sm font-semibold tabular-nums">{shortDate(start)} – {shortDate(addDays(start, 6))}</p><Button type="button" variant="outline" size="sm" onClick={() => setStart(addDays(start, 7))}>Sonraki</Button><Button type="button" variant="ghost" size="sm" onClick={() => setStart(weekStart())}>Bugün</Button></div><div className="flex flex-col gap-2 min-[430px]:flex-row"><AdminSearchInput value={search} onValueChange={setSearch} placeholder="Personel ara…" label="Vardiyada personel ara" /><AdminFilterButton activeCount={status === "all" ? 0 : 1} onClick={() => setFiltersOpen((open) => !open)} /></div></div>
      </AdminPanel>
      {filtersOpen ? <AdminPanel title="Filtreler"><div className="max-w-xs"><FilterSelect id="schedule-status" label="Durum" value={status} onChange={setStatus} options={[{ value: "all", label: "Tüm durumlar" }, { value: "PLANNED", label: "Planlandı" }, { value: "CONFIRMED", label: "Onaylandı" }, { value: "COMPLETED", label: "Tamamlandı" }, { value: "CANCELLED", label: "İptal" }]} /></div></AdminPanel> : null}
      <WorkspaceState module="schedules" data={resource.data} loading={resource.loading} error={resource.error} filtered={Boolean(search || status !== "all")} onRetry={() => void resource.refetch()}>{(data) => <WeeklySchedule data={data} start={start} onDone={resource.refetch} />}</WorkspaceState>
      <ScheduleDialog open={dialogOpen} onOpenChange={setDialogOpen} staff={(resource.data?.options.staff ?? []) as Option[]} onDone={resource.refetch} />
    </div>
  );
}

function WeeklySchedule({ data, start, onDone }: { data: ErpWorkspaceData; start: string; onDone: () => Promise<void> }) {
  const people = [...new Set(data.rows.map((row) => String(row.staff)))];
  const today = localDateKey();
  async function setScheduleStatus(id: string, status: "CONFIRMED" | "COMPLETED" | "CANCELLED") {
    try { await sendCommand("/api/admin/erp/schedules", { command: "SET_SCHEDULE_STATUS", scheduleId: id, status }); toast.success("Vardiya durumu güncellendi."); await onDone(); } catch (error) { toast.error(error instanceof Error ? error.message : "İşlem tamamlanamadı."); }
  }
  return (
    <AdminPanel contentClassName="p-0 sm:p-0">
      <div className="max-w-full overflow-x-auto overscroll-x-contain" aria-label="Haftalık vardiya tablosu"><div className="min-w-[980px]"><div className="grid grid-cols-[180px_repeat(7,minmax(110px,1fr))] border-b border-border bg-muted/30 text-xs text-muted-foreground"><div className="px-4 py-3 font-medium">Personel</div>{DAY_LABELS.map((label, index) => { const day = addDays(start, index); return <div key={day} className={cn("border-l border-border px-3 py-2.5 text-center", day === today && "bg-accent text-accent-foreground")}><span className="block font-semibold">{label}</span><span className="mt-0.5 block tabular-nums">{shortDate(day).split(" ").slice(0, 2).join(" ")}</span></div>; })}</div>{people.map((person) => <div key={person} className="grid min-h-24 grid-cols-[180px_repeat(7,minmax(110px,1fr))] border-b border-border last:border-b-0"><div className="flex items-center gap-3 px-4 py-3"><PersonnelAvatar name={person} /><span className="min-w-0 truncate text-sm font-semibold">{person}</span></div>{DAY_LABELS.map((_, index) => { const day = addDays(start, index); const shifts = data.rows.filter((row) => String(row.staff) === person && localDateKey(new Date(String(row.starts_at))) === day); return <div key={day} className={cn("border-l border-border p-2", day === today && "bg-accent/30")}>{shifts.map((row) => { const status = String(row.status); const actions = ["PLANNED", "CONFIRMED"].includes(status) ? [{ label: status === "PLANNED" ? "Onayla" : "Tamamla", onSelect: () => void setScheduleStatus(String(row.id), status === "PLANNED" ? "CONFIRMED" : "COMPLETED") }, { label: "İptal et", danger: true, onSelect: () => void setScheduleStatus(String(row.id), "CANCELLED") }] : []; return <article key={String(row.id)} className={cn("mb-2 rounded-lg border p-2 last:mb-0", shiftColor(row))}><div className="flex items-start justify-between gap-1"><p className="text-xs font-semibold tabular-nums">{time(row.starts_at)}–{time(row.ends_at)}</p>{actions.length ? <PersonnelActionMenu label={`${person} vardiya işlemleri`} actions={actions} /> : null}</div><p className="mt-1 truncate text-[11px] text-muted-foreground">{String(row.role_label ?? row.location_label ?? erpEnumLabel(status) ?? "Vardiya")}</p></article>; })}</div>; })}</div>)}</div></div>
    </AdminPanel>
  );
}

function PayrollWorkspace() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const parameters = useMemo(() => new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), search, status: status === "all" ? "" : status }), [page, search, status]);
  const resource = useWorkspace("payroll", parameters);
  const rows = resource.data?.rows ?? [];
  const net = rows.reduce((sum, row) => sum + numberValue(row.net_payable), 0);
  const overtime = rows.reduce((sum, row) => sum + numberValue(row.overtime_minutes), 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader title={PERSONNEL_COPY.payroll.title} description={PERSONNEL_COPY.payroll.description} actions={<><Button variant="outline" onClick={() => void resource.refetch()} disabled={resource.refreshing}><RefreshCw className={resource.refreshing ? "animate-spin" : undefined} aria-hidden="true" /> Yenile</Button><Button onClick={() => setDialogOpen(true)}><Plus aria-hidden="true" /> Bordro Kaydı</Button></>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><AdminKpi label="Bordro Kaydı" value={(resource.data?.pagination.total ?? 0).toLocaleString("tr-TR")} icon={ReceiptText} /><AdminKpi label="Görüntülenen Net" value={money(net)} icon={CheckCircle2} tone="success" /><AdminKpi label="Ortalama Net" value={money(rows.length ? net / rows.length : 0)} icon={UsersRound} helper="Görüntülenen kayıtlar" /><AdminKpi label="Fazla Mesai" value={formatElapsed(overtime)} icon={TimerReset} tone="info" helper="Görüntülenen kayıtlar" /></div>
      {resource.data?.notice ? <Notice>{resource.data.notice}</Notice> : null}
      <div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-end"><AdminSearchInput value={search} onValueChange={(value) => { setSearch(value); setPage(1); }} placeholder="Personel ara…" label="Bordroda personel ara" /><AdminFilterButton activeCount={status === "all" ? 0 : 1} onClick={() => setFiltersOpen((open) => !open)} /></div>
      {filtersOpen ? <AdminPanel title="Filtreler"><div className="max-w-xs"><FilterSelect id="payroll-status" label="Durum" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "all", label: "Tüm durumlar" }, { value: "DRAFT", label: "Taslak" }, { value: "APPROVED", label: "Onaylandı" }, { value: "PAID", label: "Ödendi" }, { value: "CANCELLED", label: "İptal" }]} /></div></AdminPanel> : null}
      <WorkspaceState module="payroll" data={resource.data} loading={resource.loading} error={resource.error} filtered={Boolean(search || status !== "all")} onRetry={() => void resource.refetch()}>{(data) => <PayrollTable data={data} page={page} onPageChange={setPage} />}</WorkspaceState>
      <PayrollDialog open={dialogOpen} onOpenChange={setDialogOpen} staff={(resource.data?.options.staff ?? []) as Option[]} onDone={resource.refetch} />
    </div>
  );
}

function PayrollTable({ data, page, onPageChange }: { data: ErpWorkspaceData; page: number; onPageChange: (page: number) => void }) {
  return (
    <AdminPanel contentClassName="p-0 sm:p-0">
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-border bg-muted/35 text-xs text-muted-foreground"><th scope="col" className="px-5 py-3 font-medium">Personel</th><th scope="col" className="px-4 py-3 font-medium">Dönem</th><th scope="col" className="px-4 py-3 text-right font-medium">Brüt Maaş</th><th scope="col" className="px-4 py-3 text-right font-medium">Ek Ödemeler</th><th scope="col" className="px-4 py-3 text-right font-medium">Kesintiler</th><th scope="col" className="px-4 py-3 text-right font-medium">Net Ödeme</th><th scope="col" className="px-4 py-3 font-medium">Durum</th></tr></thead><tbody className="divide-y divide-border">{data.rows.map((row) => <tr key={String(row.id)} className="hover:bg-muted/20"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><PersonnelAvatar name={String(row.staff)} /><span className="font-semibold">{String(row.staff)}</span></div></td><td className="px-4 py-3.5 text-xs tabular-nums text-muted-foreground">{shortDate(row.period_start)} – {shortDate(row.period_end)}</td><td className="px-4 py-3.5 text-right tabular-nums">{money(row.gross_salary)}</td><td className="px-4 py-3.5 text-right tabular-nums">{money(row.allowances)}</td><td className="px-4 py-3.5 text-right tabular-nums">{money(row.deductions)}</td><td className="px-4 py-3.5 text-right font-semibold tabular-nums">{money(row.net_payable)}</td><td className="px-4 py-3.5"><Status value={row.status} /></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-border md:hidden">{data.rows.map((row) => <article key={String(row.id)} className="p-4"><div className="flex items-start gap-3"><PersonnelAvatar name={String(row.staff)} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{String(row.staff)}</p><p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{shortDate(row.period_start)} – {shortDate(row.period_end)}</p></div><Status value={row.status} /></div><dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs"><div><dt className="text-muted-foreground">Brüt</dt><dd className="mt-1 font-medium tabular-nums">{money(row.gross_salary)}</dd></div><div><dt className="text-muted-foreground">Net</dt><dd className="mt-1 font-semibold tabular-nums">{money(row.net_payable)}</dd></div><div><dt className="text-muted-foreground">Ek ödemeler</dt><dd className="mt-1 tabular-nums">{money(row.allowances)}</dd></div><div><dt className="text-muted-foreground">Kesintiler</dt><dd className="mt-1 tabular-nums">{money(row.deductions)}</dd></div></dl></article>)}</div>
      <AdminPagination page={page} totalPages={data.pagination.totalPages} total={data.pagination.total} onPageChange={onPageChange} />
    </AdminPanel>
  );
}

export function PersonnelWorkspaceManager({ module }: { module: PersonnelModule }) {
  if (module === "attendance") return <AttendanceWorkspace />;
  if (module === "schedules") return <ScheduleWorkspace />;
  return <PayrollWorkspace />;
}
