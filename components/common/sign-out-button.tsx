import { signOutAction } from "@/app/(app)/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="flex min-h-10 cursor-pointer items-center rounded-md border border-transparent px-1.5 text-[13px] whitespace-nowrap text-ink-header transition-colors duration-120 hover:border-line-strong hover:bg-[#F7F9FB] hover:text-ink sm:px-2.5 sm:py-[5px]"
      >
        Выйти
      </button>
    </form>
  );
}
