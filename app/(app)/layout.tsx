import Link from "next/link";
import { redirect } from "next/navigation";

import { AppBadge } from "@/components/common/app-badge";
import { NavigationTracker } from "@/components/common/back-link";
import { ChangelogLink } from "@/components/common/changelog-link";
import { CalendarIcon, UserIcon } from "@/components/common/icons";
import { SignOutButton } from "@/components/common/sign-out-button";
import { ThemeToggle } from "@/components/common/theme-toggle";
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

  // Непрочитанное по всем проектам — стартовое значение для значка: с ним
  // число видно сразу, без запроса после загрузки страницы.
  const { data: unreadTotal } = await supabase.rpc("chat_unread_total");

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <NavigationTracker />
      <AppBadge initial={unreadTotal ?? 0} />
      {/* На узком экране зазоры меньше: на 390 px шапка с «Что нового» иначе
          вылезала за край ровно на 10 px. */}
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-line-strong bg-surface px-3 sm:gap-6 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-5">
          <Link href="/projects" className="flex min-h-10 min-w-0 items-center gap-[9px]">
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-brand text-white">
              <CalendarIcon size={12} strokeWidth={1.6} />
            </span>
            {/* На очень узком экране название уступает место кнопкам: без
                усечения шапка наезжала сама на себя (телефон 320–360 px). */}
            <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
              Планировщик
            </span>
          </Link>
          <span className="hidden h-[18px] w-px bg-line-strong sm:block" />
          <ChangelogLink />
          <Link
            href="/profile"
            aria-label="Профиль"
            // min-h-10: на телефоне палец должен попадать в ссылку, а не в 5-пиксельную щель.
            className="flex min-h-10 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-[13px] text-ink-muted transition-colors duration-120 hover:bg-page hover:text-ink sm:px-[9px]"
          >
            <UserIcon size={16} className="hidden max-[379px]:block" />
            <span className="max-[379px]:hidden">Профиль</span>
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
