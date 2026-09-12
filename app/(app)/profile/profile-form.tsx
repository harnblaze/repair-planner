"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { profileSchema, type ProfileInput } from "@/lib/validation/auth";

import { updateProfileAction } from "./actions";

export function ProfileForm({ fullName }: { fullName: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
    setServerError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await updateProfileAction(data);
      if (!result.ok) {
        setServerError(result.error);
      } else if (result.message) {
        setSuccessMessage(result.message);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Имя</Label>
        <Input id="fullName" {...register("fullName")} />
        {errors.fullName ? (
          <p className="text-sm text-destructive">{errors.fullName.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Сохранение…" : "Сохранить"}
      </Button>
    </form>
  );
}
