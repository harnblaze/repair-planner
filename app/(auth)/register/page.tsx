import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Регистрация — Repair Planner",
};

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Регистрация</CardTitle>
      </CardHeader>
      <CardContent>
        <RegisterForm />
      </CardContent>
    </Card>
  );
}
