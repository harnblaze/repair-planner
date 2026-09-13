"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { ALL_CATEGORIES, NO_CATEGORY, NO_CATEGORY_LABEL } from "@/lib/business/material-report";

/** Фильтр по цеху: значение хранится в URL, отчёт строится на сервере. */
export function CategoryFilter({
  month,
  category,
  categories,
}: {
  month: string;
  category: string;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams({ month });
    if (next !== ALL_CATEGORIES) params.set("category", next);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <NativeSelect
      aria-label="Цех"
      wrapperClassName="w-48"
      value={category}
      disabled={pending}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={ALL_CATEGORIES}>Все цеха</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={NO_CATEGORY}>{NO_CATEGORY_LABEL}</option>
    </NativeSelect>
  );
}
