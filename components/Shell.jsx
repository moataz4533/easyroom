"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import {
  BarChart3, BedDouble, BookOpenCheck, CalendarPlus, CalendarRange,
  ChevronLeft, ChevronRight, CircleUserRound, ClipboardCheck, CloudOff,
  Hotel, IdCard, Languages, LayoutDashboard, ListChecks, LogOut,
  MoreHorizontal, RefreshCw, Settings, ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { setHotelSettings } from "../lib/hotel-settings";
import { barePath, localePath, localizedName, useAppLocale } from "../lib/locale";
import { useOffline } from "../lib/offline";
import {
  SAVED_KEY, foreignCacheKeys, needsSwitcher, pickProperty, roleIn, sortProperties,
} from "../lib/property";

const Ctx = createContext(null);
export const useProperty = () => useContext(Ctx);

function readSavedProperty() {
  try {
    return window.localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}

/**
 * Switching hotels is a hard boundary, so it is done by reloading rather
 * than by moving a value in React state. Every screen holds rows, caches and
 * quotes belonging to the hotel it was opened in; carrying any of that across
 * is exactly the mixing this must never do. A reload costs a second and
 * removes the whole class of mistake.
 */
function switchProperty(id) {
  try {
    window.localStorage.setItem(SAVED_KEY, id);
    // The saved copies for the other hotel are of no use here and would only
    // be waiting to be shown by mistake.
    for (const key of foreignCacheKeys(Object.keys(window.localStorage), id)) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* a device that refuses storage still switches, it just forgets */
  }
  window.location.reload();
}

const NAV = [
  { href: "/", key: "today", Icon: LayoutDashboard },
  { href: "/calendar", key: "calendar", Icon: CalendarRange },
  { href: "/new-booking", key: "newBooking", mobileKey: "bookingShort", Icon: CalendarPlus },
  { href: "/bookings", key: "bookings", Icon: BookOpenCheck },
  { href: "/guests", key: "guests", Icon: IdCard },
  { href: "/passes", key: "passes", Icon: ShieldCheck },
  { href: "/housekeeping", key: "housekeeping", Icon: ClipboardCheck },
  { href: "/reports", key: "reports", Icon: BarChart3 },
  { href: "/activity", key: "activity", Icon: ListChecks },
  { href: "/settings", key: "settings", Icon: Settings },
];

const ALLOWED = {
  owner: ["/", "/calendar", "/new-booking", "/bookings", "/guests", "/passes", "/housekeeping", "/reports", "/activity", "/settings"],
  manager: ["/", "/calendar", "/new-booking", "/bookings", "/guests", "/passes", "/housekeeping", "/reports", "/activity", "/settings"],
  reception: ["/", "/calendar", "/new-booking", "/bookings", "/guests", "/passes", "/housekeeping"],
  housekeeping: ["/housekeeping"],
};

export default function Shell({ children }) {
  const router = useRouter();
  const locale = useLocale();
  const { pathname } = useAppLocale();
  const currentPath = barePath(pathname);
  const t = useTranslations("Shell");
  const common = useTranslations("Common");
  const roles = useTranslations("Roles");
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace(localePath("/login", locale));

      // Every hotel this account belongs to, and nothing else: the select
      // policy on properties is is_member(id), so the list the database
      // returns is already exactly theirs.
      const [propertyResult, memberResult, profileResult] = await Promise.all([
        supabase.from("properties").select("*"),
        supabase.from("property_members").select("role, property_id, is_active").eq("user_id", session.user.id).eq("is_active", true),
        supabase.from("profiles").select("full_name, preferred_locale").eq("id", session.user.id).maybeSingle(),
      ]);
      if (!alive) return;

      const properties = sortProperties(propertyResult.data || []);
      const memberships = memberResult.data || [];
      const property = pickProperty(properties, readSavedProperty());
      const role = roleIn(memberships, property?.id);

      // Before any screen renders. `today()` and every money line read this,
      // and until it is set they fall back to the device and to pounds —
      // which is right for nobody in particular.
      setHotelSettings(property);

      setState({
        loading: false, session, property, properties, memberships,
        profile: profileResult.data,
        role, denied: !property || !role,
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
      <div className="banner warn">{t("forbidden", { role: roles(state.role || "unknown") })}</div>
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

/**
 * Only ever shown to somebody who works in more than one hotel, which is
 * nobody until there is a second one. It names the hotel you are in as much
 * as it offers to change it — on a screen where every number belongs to one
 * hotel, knowing which is the point.
 */
function PropertySwitcher({ state, locale }) {
  const t = useTranslations("Shell");
  if (!needsSwitcher(state.properties)) return null;
  return (
    <label className="property-switcher">
      <Hotel size={16} aria-hidden="true" />
      <span className="sr-only">{t("switchHotel")}</span>
      <select
        value={state.property?.id || ""}
        onChange={(event) => switchProperty(event.target.value)}
      >
        {state.properties.map((property) => (
          <option key={property.id} value={property.id}>
            {localizedName(property, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Sidebar({ state, path, allowed }) {
  const locale = useLocale();
  const t = useTranslations("Nav");
  const roles = useTranslations("Roles");
  return (
    <aside className="sidebar">
      <Brand property={state.property} locale={locale} />
      <PropertySwitcher state={state} locale={locale} />
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
        <div><strong>{state.profile?.full_name || state.session?.user?.email?.split("@")[0]}</strong><span>{roles(state.role || "unknown")}</span></div>
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
        {/* The sidebar carries it on a wide screen; this is the phone's copy. */}
        <div className="mobile-switcher"><PropertySwitcher state={state} locale={locale} /></div>
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
  const { online, pending, provisional, syncing, sync } = useOffline();
  const t = useTranslations("Shell");
  // A booking waiting to be sent counts as an action waiting to be sent —
  // it is the one the hotel most needs to know is not through yet.
  const waiting = pending + provisional;
  if (online && waiting === 0) return null;
  return (
    <div className={`strip ${online ? "" : "off"}`} role="status">
      {!online && <><CloudOff size={16} /><span>{t("offline")}</span></>}
      {waiting > 0 && <><span>{t("pending", { count: waiting })}</span>{online && <button className="strip-btn" onClick={sync} disabled={syncing}><RefreshCw size={14} />{syncing ? t("syncing") : t("syncNow")}</button>}</>}
    </div>
  );
}

/**
 * Five slots at the bottom of a phone, and up to nine screens to reach.
 *
 * "More" used to be a link straight to Settings, which meant an owner on a
 * phone could not reach Guests, Housekeeping, Reports or the activity log at
 * all — the owner went looking for the log and could not find it, because it
 * was only on the sidebar. It is a menu now, and everything is in it.
 */
function MobileNav({ path, allowed }) {
  const locale = useLocale();
  const t = useTranslations("Nav");
  const common = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const items = NAV.filter((item) => allowed.includes(item.href));
  const shown = items.length > 5 ? items.slice(0, 4) : items;
  const rest = items.slice(shown.length);

  // Closing on navigation is what a menu is expected to do, and the route
  // changing is the only signal that a link inside it was followed.
  useEffect(() => { setOpen(false); }, [path]);

  return (
    <>
      {open && rest.length > 0 && (
        <>
          <button className="mobile-more-backdrop" aria-label={common("close")}
            onClick={() => setOpen(false)} />
          <nav className="mobile-more" aria-label={common("more")}>
            {rest.map(({ href, key, mobileKey, Icon }) => (
              <Link key={href} href={localePath(href, locale)} data-active={path === href}>
                <Icon size={19} aria-hidden="true" /><span>{t(mobileKey || key)}</span>
              </Link>
            ))}
          </nav>
        </>
      )}

      <nav className="mobile-nav" aria-label={t("today")}>
        {shown.map(({ href, key, mobileKey, Icon }) => (
          <Link key={href} href={localePath(href, locale)} data-active={path === href}>
            <Icon size={21} aria-hidden="true" /><span>{t(mobileKey || key)}</span>
          </Link>
        ))}
        {rest.length > 0 && (
          <button type="button" onClick={() => setOpen((was) => !was)}
            data-active={rest.some((item) => item.href === path)} aria-expanded={open}>
            <MoreHorizontal size={21} aria-hidden="true" /><span>{common("more")}</span>
          </button>
        )}
      </nav>
    </>
  );
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
