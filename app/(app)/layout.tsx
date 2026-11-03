import Link from "next/link";
import { redirect } from "next/navigation";

import { NavigationTracker } from "@/components/common/back-link";
import { ChangelogLink } from "@/components/common/changelog-link";
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
      <NavigationTracker />
      {/* На узком экране зазоры меньше: на 390 px шапка с «Что нового» иначе
          вылезала за край ровно на 10 px. */}
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-line-strong bg-surface px-3 sm:gap-6 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-5">
          <Link href="/projects" className="flex min-h-10 items-center gap-[9px]">
            <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-brand text-white">
              <CalendarIcon size={12} strokeWidth={1.6} />
            </span>
            <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
              Планировщик
            </span>
          </Link>
          <span className="hidden h-[18px] w-px bg-line-strong sm:block" />
          <ChangelogLink />
          <Link
            href="/profile"
            // min-h-10: на телефоне палец должен попадать в ссылку, а не в 5-пиксельную щель.
            className="flex min-h-10 items-center rounded-md px-1.5 text-[13px] text-ink-muted transition-colors duration-120 hover:bg-page hover:text-ink sm:px-[9px]"
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
