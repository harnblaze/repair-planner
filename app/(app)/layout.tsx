import Link from "next/link";
import { redirect } from "next/navigation";

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
    <div className="min-h-screen">
      <nav className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-4 text-sm">
          <Link href="/projects" className="font-medium hover:underline">
            Repair Planner
          </Link>
          <Link href="/profile" className="text-muted-foreground hover:underline">
            Профиль
          </Link>
        </div>
        <SignOutButton />
      </nav>
      {children}
    </div>
  );
}
