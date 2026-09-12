"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RUSSIAN_TIMEZONES, projectSchema, type ProjectInput } from "@/lib/validation/project";

import { updateProjectAction } from "./actions";

export function SettingsForm({ projectId, project }: { projectId: string; project: ProjectInput }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: project,
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await updateProjectAction(projectId, data);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Сохранено.");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Название проекта</Label>
        <Input id="name" {...register("name")} />
        {errors.name ? <p className="text-[11.5px] text-status-alert-fg">{errors.name.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">Часовой пояс</Label>
        <NativeSelect id="timezone" {...register("timezone")}>
          {RUSSIAN_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </NativeSelect>
        {errors.timezone ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.timezone.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Сохранение…" : "Сохранить"}
      </Button>
    </form>
  );
}
