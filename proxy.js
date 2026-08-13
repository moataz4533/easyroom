import { NextResponse } from "next/server";

const LOCALES = new Set(["ar", "en"]);

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const parts = pathname.split("/");
  const pathLocale = LOCALES.has(parts[1]) ? parts[1] : null;

  if (!pathLocale) {
    const preferred = request.cookies.get("easyroom-locale")?.value === "en" ? "en" : "ar";
    const target = request.nextUrl.clone();
    target.pathname = `/${preferred}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(target);
  }

  const target = request.nextUrl.clone();
  target.pathname = `/${parts.slice(2).join("/")}` || "/";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-easyroom-locale", pathLocale);

  const response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
  response.cookies.set("easyroom-locale", pathLocale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|icon.svg|manifest-ar.json|manifest-en.json|sw.js|.*\\..*).*)"],
};
