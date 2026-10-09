import { BADGE_BASE } from "@/components/common/status-badge";
import { balanceState } from "@/lib/business/material-stock";
import { cn } from "@/lib/utils";

/**
 * Состояние остатка материала (docs/redesign.md §6 «Состояния остатков материалов»).
 * Отрицательный остаток — допустимое бизнес-состояние, а не системная ошибка,
 * поэтому он оформляется бейджем, без иконок ошибки и без рамки на всей строке.
 */
export function BalanceBadge({
  balance,
  minimumBalance,
  className,
}: {
  balance: number;
  minimumBalance: number;
  className?: string;
}) {
  const state = balanceState(balance, minimumBalance);

  if (state === "negative") {
    return (
      <span className={cn(BADGE_BASE, "bg-status-alert-bg text-status-alert-fg", className)}>
        отрицательный остаток
      </span>
    );
  }

  if (state === "low") {
    return (
      <span className={cn(BADGE_BASE, "bg-status-warn-bg text-status-warn-fg", className)}>
        низкий остаток
      </span>
    );
  }

  return null;
}
