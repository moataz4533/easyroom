"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  BarChart3, BedDouble, BookOpenCheck, CalendarPlus, ChevronLeft,
  ChevronRight, CircleUserRound, ClipboardCheck, CloudOff, Hotel,
  Languages, LayoutDashboard, LogOut, RefreshCw, Settings,
} from "lucide-react";
import { supabase, PROPERTY_SLUG } from "../lib/supabase";
import { barePath, localePath, localizedName, useAppLocale } from "../lib/locale";
import { useOffline } from "../lib/offline";

const Ctx = createContext(null);
export const useProperty = () => useContext(Ctx);

const NAV = [
  { href: "/", key: "today", Icon: LayoutDashboard },
  { href: "/new-booking", key: "newBooking", mobileKey: "bookingShort", Icon: CalendarPlus },
  { href: "/bookings", key: "bookings", Icon: BookOpenCheck },
  { href: "/housekeeping", key: "housekeeping", Icon: ClipboardCheck },
  { href: "/reports", key: "reports", Icon: BarChart3 },
  { href: "/settings", key: "settings", Icon: Settings },
];

const ALLOWED = {
  owner: ["/", "/new-booking", "/bookings", "/housekeeping", "/reports", "/settings"],
  manager: ["/", "/new-booking", "/bookings", "/housekeeping", "/reports", "/settings"],
  reception: ["/", "/new-booking", "/bookings", "/housekeeping"],
  housekeeping: ["/housekeeping"],
};

export default function Shell({ children }) {
  const router = useRouter();
  const locale = useLocale();
  const { pathname } = useAppLocale();
  const currentPath = barePath(pathname);
  const t = useTranslations("Shell");
  const common = useTranslations("Common");
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace(localePath("/login", locale));

      const [propertyResult, memberResult, profileResult] = await Promise.all([
        supabase.from("properties").select("*").eq("slug", PROPERTY_SLUG).maybeSingle(),
        supabase.from("property_members").select("role, property_id").eq("user_id", session.user.id).eq("is_active", true).maybeSingle(),
        supabase.from("profiles").select("full_name, preferred_locale").eq("id", session.user.id).maybeSingle(),
      ]);
      if (!alive) return;
      const property = propertyResult.data;
      const membership = memberResult.data;
      setState({
        loading: false, session, property, profile: profileResult.data,
        role: membership?.role || null, denied: !property || !membership,
        error: propertyResult.error?.message,
      });
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(localePath("/login", locale));
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [locale, router]);

  if (state.loading) return <LoadingScreen label={t("loading")} />;

  async function logout() {
    await supabase.auth.signOut();
    router.replace(localePath("/login", locale));
  }

  if (state.denied) {
    return (
      <div className="center-page auth-surface">
        <div className="card access-card">
          <div className="empty-icon"><Hotel size={24} /></div>
          <h2>{t("noHotel")}</h2>
          <p>{t("noHotelBody")}</p>
          <button className="btn primary wide" onClick={logout}><LogOut size={18} />{common("logout")}</button>
        </div>
      </div>
    );
  }

  const allowed = ALLOWED[state.role] || [];
  const content = allowed.includes(currentPath) ? children : (
    <div className="card access-card">
      <div className="banner warn">{t("forbidden", { role: roleLabel(state.role, locale) })}</div>
      <Link className="btn primary" href={localePath(allowed[0] || "/", locale)}>{t("goHome")}</Link>
    </div>
  );

  return (
    <Ctx.Provider value={state}>
      <div className="app-shell">
        <Sidebar state={state} path={currentPath} allowed={allowed} />
        <div className="app-workspace">
          <Topbar state={state} onLogout={logout} />
          <StatusStrip />
          <main className="wrap">{content}</main>
          <MobileNav path={currentPath} allowed={allowed} />
        </div>
      </div>
    </Ctx.Provider>
  );
}

function LoadingScreen({ label }) {
  return <div className="center-page auth-surface"><div className="loading-mark"><BedDouble size={28} /><span>{label}</span></div></div>;
}

function Brand({ property, locale, compact = false }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <div className="brand-mark"><img src={property?.logo_url || "/easyroom-logo.png"} alt="" />{/* eslint-disable-line @next/next/no-img-element */}</div>
      <div className="brand-copy">
        <strong>{localizedName(property, locale) || "Easyroom"}</strong>
        {!compact && <span>EASYROOM</span>}
      </div>
    </div>
  );
}

function Sidebar({ state, path, allowed }) {
  const locale = useLocale();
  const t = useTranslations("Nav");
  return (
    <aside className="sidebar">
      <Brand property={state.property} locale={locale} />
      <nav className="side-nav" aria-label={t("today")}>
        {NAV.filter((item) => allowed.includes(item.href)).map(({ href, key, Icon }) => (
          <Link key={href} href={localePath(href, locale)} data-active={path === href}>
            <Icon size={19} aria-hidden="true" /><span>{t(key)}</span>
            {locale === "ar" ? <ChevronLeft className="nav-chevron" size={15} /> : <ChevronRight className="nav-chevron" size={15} />}
          </Link>
        ))}
      </nav>
      <div className="sidebar-user">
        <CircleUserRound size={20} />
        <div><strong>{state.profile?.full_name || state.session?.user?.email?.split("@")[0]}</strong><span>{roleLabel(state.role, locale)}</span></div>
      </div>
    </aside>
  );
}

function Topbar({ state, onLogout }) {
  const locale = useLocale();
  const common = useTranslations("Common");
  const { switchLocale } = useAppLocale();
  return (
    <header className="topbar">
      <div className="mobile-brand"><Brand property={state.property} locale={locale} compact /></div>
      <Clock />
      <div className="topbar-actions">
        <button className="icon-button language-button" onClick={switchLocale} aria-label={common("language")}>
          <Languages size={18} /><span>{common("language")}</span>
        </button>
        <button className="icon-button" onClick={onLogout} aria-label={common("logout")} title={common("logout")}>
          <LogOut size={18} /><span className="sr-only">{common("logout")}</span>
        </button>
      </div>
    </header>
  );
}

export function Clock() {
  const locale = useLocale();
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const formats = locale === "ar" ? "ar-EG" : "en-GB";
  if (!now) return <div className="clock" aria-hidden="true" />;
  return (
    <div className="clock">
      <time className="clock-time mono" dateTime={now.toISOString()}>{now.toLocaleTimeString(formats, { hour: "2-digit", minute: "2-digit" })}</time>
      <span className="clock-date">{now.toLocaleDateString(formats, { weekday: "long", day: "numeric", month: "long" })}</span>
    </div>
  );
}

function StatusStrip() {
  const { online, pending, syncing, sync } = useOffline();
  const t = useTranslations("Shell");
  if (online && pending === 0) return null;
  return (
    <div className={`strip ${online ? "" : "off"}`} role="status">
      {!online && <><CloudOff size={16} /><span>{t("offline")}</span></>}
      {pending > 0 && <><span>{t("pending", { count: pending })}</span>{online && <button className="strip-btn" onClick={sync} disabled={syncing}><RefreshCw size={14} />{syncing ? t("syncing") : t("syncNow")}</button>}</>}
    </div>
  );
}

function MobileNav({ path, allowed }) {
  const locale = useLocale();
  const t = useTranslations("Nav");
  const common = useTranslations("Common");
  let items = NAV.filter((item) => allowed.includes(item.href));
  if (items.length > 5) items = [...items.slice(0, 4), { ...items[5], key: "settings", mobileLabel: common("more") }];
  return (
    <nav className="mobile-nav" aria-label={t("today")}>
      {items.map(({ href, key, mobileKey, mobileLabel, Icon }) => (
        <Link key={href} href={localePath(href, locale)} data-active={path === href}>
          <Icon size={21} aria-hidden="true" /><span>{mobileLabel || t(mobileKey || key)}</span>
        </Link>
      ))}
    </nav>
  );
}

export function roleLabel(role, locale = "ar") {
  const labels = {
    ar: { owner: "المالك", manager: "مدير", reception: "استقبال", housekeeping: "نظافة" },
    en: { owner: "Owner", manager: "Manager", reception: "Reception", housekeeping: "Housekeeping" },
  };
  return labels[locale]?.[role] || "—";
}

export function Toast({ msg, bad }) {
  if (!msg) return null;
  return <div className={`toast ${bad ? "bad" : ""}`} role="status">{msg}</div>;
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, bad = false) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast(null), 3200);
  };
  return [toast, show];
}
