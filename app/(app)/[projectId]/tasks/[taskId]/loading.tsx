import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Повторяет раскладку страницы заявки: заголовок со статусом, строка свойств,
// описание, материалы и фото.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <Skeleton className="h-7 w-full sm:flex-1" />
          <Skeleton className="h-[30px] w-40" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-[30px] w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-[52px] w-full" />
          <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-[30px] w-full" />
          </div>
          <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
            <Skeleton className="h-4 w-16" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
