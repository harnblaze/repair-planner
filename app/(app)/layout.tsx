import { redirect } from "next/navigation";

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

  return <div className="min-h-screen">{children}</div>;
}
