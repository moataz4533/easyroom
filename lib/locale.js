"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "./supabase";
import { barePath, localePath, localizedName } from "./locale-utils";

export { SUPPORTED_LOCALES, barePath, localePath, localizedName } from "./locale-utils";

export function currentLocale() {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}

export function useAppLocale() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale() {
    const next = locale === "ar" ? "en" : "ar";
    document.cookie = `easyroom-locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    localStorage.setItem("easyroom:locale", next);
    router.replace(localePath(pathname, next));
    router.refresh();

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) return supabase.from("profiles").update({ preferred_locale: next }).eq("id", session.user.id);
      return null;
    });
  }

  return { locale, pathname, barePath: barePath(pathname), switchLocale };
}
