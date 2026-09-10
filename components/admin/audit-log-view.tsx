"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, History, RefreshCw, Search } from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { userErrorMessage } from "@/lib/api/error-message";
import { adminApi, type AuditLogPageResult } from "@/lib/api/endpoints";
import { auditFieldLabel } from "@/lib/domain/audit-log";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

/**
 * İşlem Geçmişi: who did what, where, and when.
 *
 * A reading screen and nothing else — there is no control here that changes a
 * record, because the record is the evidence. Each row answers the four
 * questions a manager actually asks, and the identifiers an engineer would
 * want sit under "Teknik ayrıntılar" where they do not crowd the sentence.
 */

const PAGE_SIZE = 25;

function AuditRow({ entry }: { readonly entry: AuditLogPageResult["entries"][number] }) {
  const [open, setOpen] = useState(false);
  const clock = new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(entry.at));

  return (
    <li className="border-b last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          {/* Who, then what, then where — the order somebody reads it in. */}
          <p className="text-sm">
            <span className="font-bold">{entry.actorName ?? "Sistem"}</span>{" "}
            <span>{entry.actionLabel.toLocaleLowerCase("tr-TR")}</span>
            <span className="text-muted-foreground"> · {entry.entityLabel}</span>
          </p>
          {entry.changes.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {entry.changes
                .map((change) =>
                  change.before !== null && change.after !== null
                    ? `${auditFieldLabel(change.field)}: ${change.before} → ${change.after}`
                    : `${auditFieldLabel(change.field)}: ${change.after ?? change.before}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">{clock}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            aria-expanded={open}
            aria-label={`${entry.actionLabel} için teknik ayrıntılar`}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>
      {open ? (
        <dl className="grid gap-1 border-t bg-muted/25 px-4 py-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold text-muted-foreground">İşlem: </dt>
            <dd className="inline">{entry.action}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-muted-foreground">Kayıt türü: </dt>
            <dd className="inline">{entry.entityType}</dd>
          </div>
          {entry.entityId ? (
            <div className="sm:col-span-2">
              <dt className="inline font-semibold text-muted-foreground">Kayıt: </dt>
              <dd className="inline break-all font-mono">{entry.entityId}</dd>
            </div>
          ) : null}
          {entry.requestId ? (
            <div className="sm:col-span-2">
              <dt className="inline font-semibold text-muted-foreground">İstek: </dt>
              <dd className="inline break-all font-mono">{entry.requestId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}

export function AuditLogView() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actorId, setActorId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search.trim()) params.set("search", search.trim());
    if (actorId) params.set("actorId", actorId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [actorId, dateFrom, dateTo, page, search]);

  const load = useCallback(
    (signal: AbortSignal) => adminApi.auditLogs(query, signal),
    [query],
  );
  const resource = useApiResource(load);
  const data = resource.data;

  return (
    <div className="space-y-5">
      {/* The window surface above already names this screen; a second title
          here would be the same words twice. */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="h-10 bg-card"
          disabled={resource.refreshing}
          onClick={() => void resource.refetch()}
        >
          <RefreshCw className={resource.refreshing ? "size-4 animate-spin" : "size-4"} /> Yenile
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <label className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="h-11 pl-9"
              placeholder="Çalışan veya işlem ara…"
              aria-label="İşlem geçmişinde ara"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </label>

          {/* Two filters to hand, the rest one tap down. */}
          <button
            type="button"
            className="flex min-h-10 items-center gap-2 self-start text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((current) => !current)}
          >
            Gelişmiş filtreler
            <ChevronDown className={cn("size-4 transition-transform", showFilters && "rotate-180")} />
          </button>

          {showFilters ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-[13px] font-medium">
                <span>Başlangıç</span>
                <Input
                  type="date"
                  className="h-11"
                  value={dateFrom}
                  onChange={(event) => {
                    setPage(1);
                    setDateFrom(event.target.value);
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium">
                <span>Bitiş</span>
                <Input
                  type="date"
                  className="h-11"
                  value={dateTo}
                  onChange={(event) => {
                    setPage(1);
                    setDateTo(event.target.value);
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium">
                <span>Çalışan</span>
                <select
                  className="h-11 rounded-lg border border-input bg-card px-3 text-[13px] font-medium"
                  value={actorId}
                  onChange={(event) => {
                    setPage(1);
                    setActorId(event.target.value);
                  }}
                >
                  <option value="">Tümü</option>
                  {(data?.actors ?? []).map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {resource.loading && !data ? (
        <LoadingState rows={6} />
      ) : resource.error && !data ? (
        <ErrorState
          title="İşlem geçmişi yüklenemedi"
          description={userErrorMessage(resource.error)}
          onRetry={() => void resource.refetch()}
        />
      ) : data && data.entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="Bu dönemde kayıt yok"
          description="Seçtiğiniz aralıkta değiştirilen bir kayıt bulunmuyor."
        />
      ) : data ? (
        <Card className="gap-0 py-0">
          <CardContent className="p-0">
            <ul>
              {data.entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </ul>
            <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
              <span className="text-muted-foreground">
                {data.total} kayıt · Sayfa {data.page}/{data.totalPages}
              </span>
              <div className="grid grid-cols-2 gap-2 min-[430px]:flex">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Önceki
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Sonraki
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
