"use client";

import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { searchAdminNavigation } from "@/components/admin/admin-navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * The field and its answers. Mounted only while the dialog is open, so every
 * opening starts from an empty field without anything having to reset it.
 */
function SearchBody({
  inputRef,
  onNavigate,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The table in memory, nothing else: no request, so typing costs nothing.
  const results = searchAdminNavigation(query);
  const searching = query.trim().length >= 2;

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const first = results[0];
        if (!first) return;
        router.push(first.destination.href);
        onNavigate();
      }}
    >
      <label className="flex items-center gap-3 border-b border-border px-4 focus-within:border-ring/40">
        <Search className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">Ekran ara</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ekran adı yazın"
          autoComplete="off"
          enterKeyHint="go"
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <p role="status" className={searching && results.length ? "sr-only" : "px-4 py-4 text-[13px] text-muted-foreground"}>
        {!searching
          ? "Ekranın adını ya da aradığınız işi yazın, örneğin “bordro” ya da “QR”."
          : results.length
            ? `${results.length} ekran bulundu.`
            : `“${query.trim()}” adında bir ekran yok. Uygulamalar listesinden bölüm seçebilirsiniz.`}
      </p>

      {searching && results.length ? (
        <ul className="p-2">
          {results.map((result) => (
            <li key={result.destination.href}>
              <Link
                href={result.destination.href}
                onClick={onNavigate}
                className="motion-press flex min-h-12 items-center gap-3 rounded-lg px-3 text-[14px] font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <result.destination.icon className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{result.destination.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{result.section}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/** Finding a screen by name, from anywhere. Enter opens the first answer. */
export function AdminNavigationSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-admin-shell
        initialFocus={inputRef}
        className="admin-search-dialog gap-0 p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">Ekran ara</DialogTitle>
        <DialogDescription className="sr-only">Yönetim ekranlarını adıyla bulun. Enter ilk sonucu açar.</DialogDescription>
        <SearchBody inputRef={inputRef} onNavigate={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
