/** Заголовок раздела карточки заявки: название, счётчик и действие справа. */
export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h2 className="text-[12.5px] font-semibold text-ink">
        {title}
        {/* Пробел текстом, а не отступом: иначе экранный диктор читает «Материалы2». */}
        {count ? <span className="font-medium text-counter"> {count}</span> : null}
      </h2>
      {action}
    </div>
  );
}
