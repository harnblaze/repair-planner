import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/types/database";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return pathname.startsWith("/auth/confirm");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Обязательно: getUser() проверяет токен на сервере Supabase, а не только
  // читает cookie, поэтому именно он, а не getSession(), защищает маршрут.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Протухший/невалидный refresh token (например, после supabase db reset в
  // разработке, либо истёкшая сессия) — SDK в этом случае осознанно не чистит
  // cookie сам (это не AuthSessionMissingError), иначе она будет безуспешно
  // присылаться и логировать ошибку на каждый запрос. signOut() здесь не
  // помогает: он сам сначала читает ту же протухшую сессию и прерывается на
  // той же ошибке, не дойдя до удаления. Чистим явно на любом ответе, который
  // в итоге вернём — редирект создаёт новый объект NextResponse.
  const staleCookieNames = error
    ? request.cookies.getAll().filter((c) => c.name.startsWith("sb-")).map((c) => c.name)
    : [];

  function withClearedStaleCookies(res: NextResponse) {
    for (const name of staleCookieNames) {
      res.cookies.delete(name);
    }
    return res;
  }

  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return withClearedStaleCookies(NextResponse.redirect(url));
  }

  if (user && (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password")) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.search = "";
    return withClearedStaleCookies(NextResponse.redirect(url));
  }

  return withClearedStaleCookies(response);
}
