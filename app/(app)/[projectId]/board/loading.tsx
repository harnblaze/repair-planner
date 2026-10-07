import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-[18px] pb-7">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-[30px] w-[248px] rounded-[7px]" />
        <Skeleton className="h-[30px] w-[132px] rounded-[7px]" />
      </div>

      <section className="overflow-hidden rounded-[10px] border border-line-strong bg-surface">
        <div className="grid grid-cols-1 md:grid-cols-[repeat(5,minmax(0,1fr))]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex min-h-24 min-w-0 flex-col border-b border-line-subtle last:border-b-0 md:min-h-[216px] md:border-r md:border-b-0">
              <div className="border-b border-line-subtle px-3.5 pt-[11px] pb-2.5">
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-col gap-[7px] p-2 xl:p-2.5">
                <Skeleton className="h-14 w-full rounded-[7px]" />
                <Skeleton className="h-14 w-full rounded-[7px]" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))] xl:gap-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex min-w-0 flex-col rounded-[10px] border border-line-strong bg-surface"
          >
            <div className="border-b border-line-subtle px-3.5 py-[11px]">
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="border-b border-line-subtle px-3.5 py-3">
              <Skeleton className="h-[30px] w-full rounded-[7px]" />
            </div>
            <div className="p-3.5">
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
