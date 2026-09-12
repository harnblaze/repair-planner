import { signOutAction } from "@/app/(app)/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="cursor-pointer rounded-md border border-transparent px-2.5 py-[5px] text-[13px] text-ink-header transition-colors duration-120 hover:border-line-strong hover:bg-[#F7F9FB] hover:text-ink"
      >
        Выйти
      </button>
    </form>
  );
}
