const SKELETON_CARD_COUNT = 4;

export function MenuLoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[90] min-h-[100dvh] overflow-y-auto bg-background" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="menu-content min-h-[100dvh] animate-pulse motion-reduce:animate-none">
        <div className="h-[calc(env(safe-area-inset-top)+var(--menu-header-height))] bg-sidebar" />
        <main className="menu-shell pb-6">
          <div className="h-[var(--menu-category-height)] border-b border-border/50" />
          <section className="pt-4">
            <div className="mb-3 h-8 w-40 rounded-lg bg-muted" />
            <div className="grid items-stretch gap-2 md:grid-cols-2 md:gap-3">
              {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
                <div key={index} className="h-full">
                  <div className="flex h-full gap-3 rounded-xl bg-card p-3">
                    <div className="size-23 shrink-0 rounded-lg bg-muted" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="h-10 rounded-md bg-muted" />
                      <div className="mt-1 h-5 w-20 rounded bg-muted" />
                      <div className="mt-1 h-10 rounded-md bg-muted/80" />
                      <div className="mt-auto h-7 w-24 rounded-md bg-muted" />
                    </div>
                    <div className="size-11 shrink-0 self-end rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
