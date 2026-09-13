import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { projectRoleLabel } from "@/lib/business/project-roles";
import { mapInvitationError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/validation/members";

import { AcceptInvitationButton } from "./accept-invitation-button";

export const metadata: Metadata = {
  title: "Приглашение в проект — Repair Planner",
  // Токен в адресе не должен уходить в Referer.
  referrer: "no-referrer",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;

  let invitation = null;
  if (invitationTokenSchema.safeParse(token).success) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("get_project_invitation", { p_token: token })
      .maybeSingle();
    if (error) console.error("InvitePage:", error.message);
    invitation = data;
  }

  const unavailableMessage =
    !invitation
      ? mapInvitationError("invitation_not_found")
      : invitation.status === "used"
        ? mapInvitationError("invitation_used")
        : invitation.status === "expired"
          ? mapInvitationError("invitation_expired")
          : null;

  return (
    <main className="mx-auto flex max-w-sm w-full flex-col gap-4 px-5 pt-6 pb-7">
      <Card>
        <CardHeader>
          <CardTitle>Приглашение в проект</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-[12.5px]">
          {invitation ? (
            <dl className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-meta">Проект</dt>
                <dd className="font-semibold text-ink">{invitation.project_name}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-meta">Роль</dt>
                <dd className="text-ink">{projectRoleLabel(invitation.role)}</dd>
              </div>
              {invitation.inviter_name ? (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-meta">Пригласил(а)</dt>
                  <dd className="text-ink">{invitation.inviter_name}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {unavailableMessage ? (
            <>
              <p className="text-status-alert-fg">{unavailableMessage}</p>
              <Link href="/projects" className="text-meta hover:text-ink">
                ← К проектам
              </Link>
            </>
          ) : invitation?.status === "already_member" ? (
            <>
              <p className="text-meta">Вы уже участник этого проекта.</p>
              <AcceptInvitationButton token={token} label="Перейти в проект" />
            </>
          ) : (
            <AcceptInvitationButton token={token} label="Принять приглашение" />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
