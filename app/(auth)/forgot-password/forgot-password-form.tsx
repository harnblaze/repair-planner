"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth";

import { forgotPasswordAction } from "./actions";

export function ForgotPasswordForm() {
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const result = await forgotPasswordAction(data);
      if (result.ok && result.message) setSuccessMessage(result.message);
    });
  });

  if (successMessage) {
    return (
      <Alert>
        <AlertDescription>{successMessage}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
      </div>

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Отправка…" : "Отправить ссылку"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground hover:underline">
          Вернуться ко входу
        </Link>
      </p>
    </form>
  );
}
