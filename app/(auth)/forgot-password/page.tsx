import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Восстановление пароля — Repair Planner",
};

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Восстановление пароля</CardTitle>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </Card>
  );
}
