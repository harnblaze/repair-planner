import { Button } from "@/components/ui/button";

import { signOutAction } from "./actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        Выйти
      </Button>
    </form>
  );
}
