import { Label } from "@/components/ui/label";

/** Ячейка строки свойств заявки: мелкая подпись над полем, чтобы поля стояли в ряд. */
export function PropertyField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-[11px] font-medium text-meta">
        {label}
      </Label>
      {children}
    </div>
  );
}
