import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/common/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Профиль — Планировщик",
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <main className="mx-auto flex max-w-sm w-full flex-col gap-4 px-5 pt-6 pb-7">
      {/* Профиль — единственная страница вне проекта: без этой ссылки из него
          некуда деться, кроме как править адрес руками. Возврат — туда, откуда
          пришли, иначе к списку проектов. */}
      <BackLink fallbackHref="/projects" />
      <Card>
        <CardHeader>
          <CardTitle>Профиль</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12px] text-meta">{user.email}</p>
          <ProfileForm fullName={profile?.full_name ?? ""} />
        </CardContent>
      </Card>
    </main>
  );
}
