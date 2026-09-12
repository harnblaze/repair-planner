import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Вход — Repair Planner",
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Вход</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
