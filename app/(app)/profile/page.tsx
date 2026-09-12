import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "Профиль — Repair Planner",
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
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Профиль</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <ProfileForm fullName={profile?.full_name ?? ""} />
        </CardContent>
      </Card>
      <SignOutButton />
    </main>
  );
}
