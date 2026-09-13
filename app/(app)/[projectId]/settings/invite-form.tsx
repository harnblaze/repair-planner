"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { INVITABLE_ROLES, projectRoleLabel } from "@/lib/business/project-roles";
import { invitationSchema, type InvitationInput } from "@/lib/validation/members";

import { createInvitationAction } from "./members-actions";

// Ссылка показывается один раз: в БД хранится только хеш токена.
export function InviteForm({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  const { register, handleSubmit } = useForm<InvitationInput>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { role: "viewer" },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await createInvitationAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink(`${window.location.origin}/invite/${result.token}`);
    });
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Ссылка скопирована.");
    } catch {
      toast.error("Не удалось скопировать. Выделите ссылку и скопируйте вручную.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="flex items-end gap-2" noValidate>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="invite-role">Роль</Label>
          <NativeSelect id="invite-role" {...register("role")}>
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {projectRoleLabel(role)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Создание…" : "Создать ссылку"}
        </Button>
      </form>

      {link ? (
        <div className="flex flex-col gap-2 rounded-[7px] border border-line-strong bg-page p-2.5">
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copy}>
              Копировать
            </Button>
          </div>
          <p className="text-[11px] text-meta-alt">
            Отправьте ссылку участнику. Она одноразовая, действует 7 дней и больше не будет показана.
          </p>
        </div>
      ) : null}
    </div>
  );
}
