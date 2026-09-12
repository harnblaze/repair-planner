import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ListPageSkeleton({
  maxWidth = "max-w-lg",
  rows = 4,
}: {
  maxWidth?: string;
  rows?: number;
}) {
  return (
    <main className={`mx-auto flex ${maxWidth} w-full flex-col gap-4 px-5 pt-6 pb-7`}>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full" />
          <div className="flex flex-col gap-3 divide-y divide-line-subtle">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2 pt-3 first:pt-0">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
