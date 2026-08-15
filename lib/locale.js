"use client";

import { useLocale as useIntlLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "./supabase";
import { barePath, localePath, localizedName } from "./locale-utils";

export { SUPPORTED_LOCALES, barePath, localePath, localizedName } from "./locale-utils";

export function currentLocale() {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}

/**
 * The app's locale, always "ar" or "en".
 *
 * next-intl is handed "ar-u-nu-arab" rather than "ar", because that is what
 * makes ICU render ٣ instead of 3 — without it a counter coming from a
 * message sat next to a number from formatNumber in different digits, on
 * every screen that has both. The rest of the app should never see that
 * tag, so it reads the locale through here.
 */
export function useLocale() {
  return useIntlLocale().startsWith("ar") ? "ar" : "en";
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
