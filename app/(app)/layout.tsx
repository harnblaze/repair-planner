import Link from "next/link";
import { redirect } from "next/navigation";

import { CalendarIcon } from "@/components/common/icons";
import { SignOutButton } from "@/components/common/sign-out-button";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proxy уже защищает маршрут, эта проверка — второй, независимый слой защиты
  // на случай ошибки в matcher'е (см. рекомендацию Next.js про Server Functions).
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-6 border-b border-line-strong bg-surface px-5">
        <div className="flex items-center gap-5">
          <Link href="/projects" className="flex items-center gap-[9px]">
            <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-brand text-white">
              <CalendarIcon size={12} strokeWidth={1.6} />
            </span>
            <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
              Repair Planner
            </span>
          </Link>
          <span className="h-[18px] w-px bg-line-strong" />
          <Link
            href="/profile"
            className="rounded-md px-[9px] py-[5px] text-[13px] text-ink-muted transition-colors duration-120 hover:bg-page hover:text-ink"
          >
            Профиль
          </Link>
        </div>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
