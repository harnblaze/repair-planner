import { ListPageSkeleton } from "@/components/common/list-page-skeleton";

export default function Loading() {
  return <ListPageSkeleton maxWidth="max-w-lg" rows={5} />;
}
