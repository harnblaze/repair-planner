"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { profileSchema, type ProfileInput } from "@/lib/validation/auth";

import { updateProfileAction } from "./actions";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName },
  });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await updateProfileAction(data);
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
        <Label htmlFor="fullName">Имя</Label>
        <Input id="fullName" {...register("fullName")} />
        {errors.fullName ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.fullName.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Сохранение…" : "Сохранить"}
      </Button>
    </form>
  );
}
