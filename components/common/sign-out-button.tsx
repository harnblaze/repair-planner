import { signOutAction } from "@/app/(app)/actions";
import { ExitIcon } from "@/components/common/icons";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        // На узком экране шапка не помещается с двумя подписями: остаётся
        // иконка, подпись для скринридера — в aria-label.
        aria-label="Выйти"
        className="flex min-h-10 min-w-9 cursor-pointer items-center justify-center rounded-md border border-transparent px-1.5 text-[13px] whitespace-nowrap text-ink-header transition-colors duration-120 hover:border-line-strong hover:bg-row-hover hover:text-ink sm:px-2.5 sm:py-[5px]"
      >
        <ExitIcon size={16} className="hidden max-[379px]:block" />
        <span className="max-[379px]:hidden">Выйти</span>
      </button>
    </form>
  );
}
