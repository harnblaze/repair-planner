"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { INVITABLE_ROLES, projectRoleLabel, type ProjectRole } from "@/lib/business/project-roles";

import { leaveProjectAction, removeMemberAction, updateMemberRoleAction } from "./members-actions";

export type Member = {
  userId: string;
  name: string;
  email: string | null;
  role: ProjectRole;
};

export function MemberRow({
  projectId,
  member,
  isSelf,
  canManage,
}: {
  projectId: string;
  member: Member;
  isSelf: boolean;
  /** Текущий пользователь — владелец проекта. */
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const isOwnerRow = member.role === "owner";

  const changeRole = (role: string) => {
    startTransition(async () => {
      const result = await updateMemberRoleAction(projectId, member.userId, role);
      if (!result.ok) toast.error(result.error);
      else toast.success("Роль изменена.");
    });
  };

  const remove = () => {
    if (!window.confirm(`Удалить ${member.name} из проекта?`)) return;
    startTransition(async () => {
      const result = await removeMemberAction(projectId, member.userId);
      if (!result.ok) toast.error(result.error);
      else toast.success("Участник удалён.");
    });
  };

  const leave = () => {
    if (!window.confirm("Покинуть проект? Вернуться можно только по новому приглашению.")) return;
    startTransition(async () => {
      const result = await leaveProjectAction(projectId);
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[12.5px] font-semibold text-ink">
          {member.name}
          {isSelf ? <span className="font-normal text-meta"> (вы)</span> : null}
        </span>
        {member.email ? <span className="truncate text-[11px] text-meta-alt">{member.email}</span> : null}
      </div>

      <div className="flex items-center gap-2">
        {canManage && !isOwnerRow ? (
          <>
            <NativeSelect
              wrapperClassName="w-40"
              aria-label={`Роль: ${member.name}`}
              value={member.role}
              disabled={pending}
              onChange={(e) => changeRole(e.target.value)}
            >
              {INVITABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {projectRoleLabel(role)}
                </option>
              ))}
            </NativeSelect>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Удалить
            </Button>
          </>
        ) : (
          <span className="text-[12px] text-meta">{projectRoleLabel(member.role)}</span>
        )}
        {isSelf && !isOwnerRow ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={leave}>
            Покинуть проект
          </Button>
        ) : null}
      </div>
    </div>
  );
}
