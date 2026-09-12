"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";

import { registerAction } from "./actions";

export function RegisterForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit((data) => {
    setServerError(null);
    startTransition(async () => {
      const result = await registerAction(data);
      if (!result.ok) {
        setServerError(result.error);
      } else if (result.message) {
        setSuccessMessage(result.message);
      }
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
      {serverError ? (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Имя</Label>
        <Input id="fullName" autoComplete="name" {...register("fullName")} />
        {errors.fullName ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.fullName.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email ? <p className="text-[11.5px] text-status-alert-fg">{errors.email.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.password.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">Повторите пароль</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="text-[11.5px] text-status-alert-fg">{errors.confirmPassword.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Регистрация…" : "Зарегистрироваться"}
      </Button>

      <p className="text-center text-[12px] text-meta">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="text-foreground hover:underline">
          Войти
        </Link>
      </p>
    </form>
  );
}
