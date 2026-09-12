import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Новый пароль — Repair Planner",
};

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Новый пароль</CardTitle>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}
