import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8 sm:px-6" aria-label="Sayfa yükleniyor">
      <div className="mx-auto max-w-6xl">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full rounded-lg" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="mt-6 h-80 rounded-2xl" />
      </div>
    </main>
  );
}
