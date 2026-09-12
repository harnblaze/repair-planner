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
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password")) {
    const url = request.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
