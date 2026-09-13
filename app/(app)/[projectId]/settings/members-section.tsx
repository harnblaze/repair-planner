import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/business/dates";
import {
  canManageProject,
  isInvitationExpired,
  projectRoleLabel,
  type ProjectRole,
} from "@/lib/business/project-roles";
import { createClient } from "@/lib/supabase/server";

import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
import { RevokeInvitationButton } from "./revoke-invitation-button";

export async function MembersSection({
  projectId,
  role,
  timezone,
}: {
  projectId: string;
  role: ProjectRole | null;
  timezone: string;
}) {
  const supabase = await createClient();
  const canManage = canManageProject(role);

  const [
    {
      data: { user },
    },
    { data: members, error: membersError },
    { data: invitations, error: invitationsError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("project_member_list", { p_project_id: projectId }),
    // Не-владельцу RLS вернёт пустой список — запрос не выполняем вовсе.
    canManage
      ? supabase
          .from("project_invitations")
          .select("id, role, created_at, expires_at")
          .eq("project_id", projectId)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersError) console.error("MembersSection (members):", membersError);
  if (invitationsError) console.error("MembersSection (invitations):", invitationsError);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Участники</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-line-subtle">
          {(members ?? []).map((member) => (
            <MemberRow
              key={member.user_id}
              projectId={projectId}
              member={{
                userId: member.user_id,
                name: member.full_name || member.email || "Без имени",
                email: member.email,
                role: member.role,
              }}
              isSelf={member.user_id === user?.id}
              canManage={canManage}
            />
          ))}
        </div>

        {canManage ? (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold text-ink">Пригласить по ссылке</h2>
              <p className="text-[11.5px] text-meta">
                «Редактор» ведёт заявки, справочники и материалы. «Только просмотр» видит данные
                проекта без изменения. Настройки и участники доступны только владельцу.
              </p>
              <InviteForm projectId={projectId} />
            </section>

            <section className="flex flex-col gap-1">
              <h2 className="text-[13px] font-semibold text-ink">Ожидают принятия</h2>
              {invitations && invitations.length > 0 ? (
                <div className="flex flex-col divide-y divide-line-subtle">
                  {invitations.map((invitation) => {
                    const expired = isInvitationExpired(invitation.expires_at);
                    return (
                      <div key={invitation.id} className="flex items-center justify-between gap-2 py-1.5">
                        <div className="flex flex-col">
                          <span className="text-[12.5px] text-ink">{projectRoleLabel(invitation.role)}</span>
                          <span className="text-[11px] text-meta-alt">
                            Создано {formatDateTime(invitation.created_at, timezone)} ·{" "}
                            {expired
                              ? "срок истёк"
                              : `до ${formatDateTime(invitation.expires_at, timezone)}`}
                          </span>
                        </div>
                        <RevokeInvitationButton projectId={projectId} invitationId={invitation.id} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState>Нет неиспользованных приглашений.</EmptyState>
              )}
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
