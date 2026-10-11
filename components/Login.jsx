"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Hotel, Languages, LockKeyhole, Mail, UserRound,
} from "lucide-react";
import { localePath, localizedName, useAppLocale, useLocale } from "../lib/locale";
import { supabase } from "../lib/supabase";
import {
  isHotelSlug, isStaffUsername, normalizeHotelSlug, openingHotel, staffLoginEmail,
} from "../lib/auth-login";
import { isReachableEmail, resetRedirectTo } from "../lib/password-reset";

// A staff username is unique inside a hotel, not across them, so a sign-in
// has to say which hotel before anybody is signed in and the database can be
// asked. The device remembers it, so staff type it once and never again.
const HOTEL_KEY = "easyroom:login-hotel";

/**
 * The sign-in screen, at /login and at each hotel's own /h/{code}.
 *
 * It used to open on the first hotel ever set up, its code filled in and
 * hidden, so every other hotel's staff had to find a small "I work at a
 * different hotel" link to sign in at all. Now it opens on the hotel the
 * link names, or the one this device remembers, or none — and it shows the
 * hotel by its name and logo, not by its code.
 */
export default function Login({ linkedHotel = null }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const { switchLocale } = useAppLocale();
  const [mode, setMode] = useState("staff");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [hotel, setHotel] = useState(() => openingHotel(linkedHotel, null));
  // undefined: not asked yet · null: no hotel by that code · object: found
  const [found, setFound] = useState(undefined);
  const [editingHotel, setEditingHotel] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const savedMode = window.localStorage.getItem("easyroom-login-mode");
    // A hotel's own link is for its staff, so it opens on staff sign-in.
    if (!linkedHotel && (savedMode === "owner" || savedMode === "staff")) setMode(savedMode);
    const opening = openingHotel(linkedHotel, window.localStorage.getItem(HOTEL_KEY));
    setHotel(opening);
    if (!opening) setEditingHotel(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(localePath("/", locale));
    });
  }, [linkedHotel, locale, router]);

  // The hotel's name, looked up from the code as it is typed. Only the name
  // and logo come back — see hotel_by_code() — and only for an exact code.
  useEffect(() => {
    const code = normalizeHotelSlug(hotel);
    if (!isHotelSlug(code)) { setFound(undefined); return undefined; }
    let alive = true;
    let retry = null;
    const ask = async (attempt) => {
      const { data, error: lookupError } = await supabase.rpc("hotel_by_code", { p_code: code });
      if (!alive) return;
      // A failed lookup is not "no such hotel": it says nothing, and the
      // sign-in itself will still answer. One more try, because the first
      // request on a weak connection is the one most likely to drop.
      if (lookupError) {
        setFound(undefined);
        if (attempt === 0) retry = window.setTimeout(() => ask(1), 1500);
        return;
      }
      setFound(data?.[0] || null);
    };
    const timer = window.setTimeout(() => ask(0), 300);
    return () => { alive = false; window.clearTimeout(timer); window.clearTimeout(retry); };
  }, [hotel]);

  const hotelName = found ? localizedName(found, locale) || found.name || found.slug : "";
  const showChip = mode === "staff" && found && !editingHotel;

  /**
   * Staff are not offered this: their password is reset by the owner from
   * Settings, and the address their username becomes has no mailbox behind
   * it. So it belongs to owner sign-in only.
   */
  async function sendReset() {
    setError(null);
    if (!isReachableEmail(email)) {
      setError(t("resetNeedsEmail"));
      return;
    }
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectTo(window.location.origin, locale),
    });
    setBusy(false);
    // The same answer whether or not an account exists, so this screen cannot
    // be used to find out which addresses are registered.
    setResetSent(true);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(null);
    if (mode === "staff" && !isHotelSlug(hotel)) {
      setError(t(normalizeHotelSlug(hotel) ? "hotelInvalid" : "hotelRequired"));
      setEditingHotel(true);
      setBusy(false);
      return;
    }
    if (mode === "staff" && found === null) {
      setError(t("hotelNotFound"));
      setEditingHotel(true);
      setBusy(false);
      return;
    }
    if (mode === "staff" && !isStaffUsername(username)) {
      setError(t("usernameInvalid"));
      setBusy(false);
      return;
    }
    const loginEmail = mode === "staff" ? staffLoginEmail(hotel, username) : email.trim();
    const result = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (result.error) {
      setError(result.error.message.includes("Invalid login")
        ? t(mode === "staff" ? "invalidStaff" : "invalidOwner")
        : result.error.message.includes("Email not confirmed") ? t("unconfirmed") : result.error.message);
      setBusy(false); return;
    }
    const { data: profile } = await supabase.from("profiles").select("preferred_locale").eq("id", result.data.user.id).maybeSingle();
    window.localStorage.setItem("easyroom-login-mode", mode);
    if (mode === "staff") window.localStorage.setItem(HOTEL_KEY, normalizeHotelSlug(hotel));
    const destination = profile?.preferred_locale === "en" ? "en" : locale;
    document.cookie = `easyroom-locale=${destination}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.replace(localePath("/", destination));
  }

  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;
  return (
    <main className="auth-surface center-page">
      <button className="language-float" onClick={switchLocale}><Languages size={17} />{common("language")}</button>
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-brand-panel">
          <div className="brand-emblem"><Image src="/easyroom-logo.png" alt="Easyroom" width={48} height={48} priority /></div>
          <div><span className="eyebrow">EASYROOM</span><h1>{t("heroTitle")}</h1><p>{t("heroBody")}</p></div>
          <div className="brand-room-lines" aria-hidden="true"><span /><span /><span /></div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <div className="login-heading">
            <span className="eyebrow">EASYROOM</span>
            <h2 id="login-title">{t("title")}</h2>
            <p>{t("subtitle")}</p>
          </div>
          {error && <div className="banner bad" role="alert">{error}</div>}
          <div className="stack form-stack">
            <div className="login-mode-switch" role="tablist" aria-label={t("loginMethod")}>
              <button type="button" role="tab" aria-selected={mode === "staff"} onClick={() => { setMode("staff"); setError(null); }}><UserRound size={16} />{t("staffLogin")}</button>
              <button type="button" role="tab" aria-selected={mode === "owner"} onClick={() => { setMode("owner"); setError(null); }}><Mail size={16} />{t("ownerLogin")}</button>
            </div>
            {mode === "staff" ? (
              <>
                {showChip ? (
                  <div className="login-hotel">
                    <div className="login-hotel-mark">
                      {found.logo_url
                        ? <img src={found.logo_url} alt="" /> /* eslint-disable-line @next/next/no-img-element */
                        : <Hotel size={20} />}
                    </div>
                    <div className="login-hotel-name">
                      <strong>{hotelName}</strong>
                      <span>{t("hotelSignedInto")}</span>
                    </div>
                    <button type="button" className="link-button" onClick={() => setEditingHotel(true)}>
                      {t("changeHotel")}
                    </button>
                  </div>
                ) : (
                  <label className="field">
                    <span>{t("hotelCode")}</span>
                    <div className="input-with-icon">
                      <Hotel size={18} />
                      <input required autoComplete="organization" value={hotel} dir="ltr"
                        autoCapitalize="none" spellCheck={false}
                        onChange={(e) => { setHotel(e.target.value); setError(null); }}
                        onBlur={() => { if (found) setEditingHotel(false); }} />
                    </div>
                    {found ? (
                      <span className="field-hint login-hotel-found"><CheckCircle2 size={14} />{hotelName}</span>
                    ) : found === null ? (
                      <span className="field-hint login-hotel-missing">{t("hotelNotFound")}</span>
                    ) : (
                      <span className="field-hint">{t("hotelCodeHint")}</span>
                    )}
                  </label>
                )}
                <label className="field"><span>{t("username")}</span><div className="input-with-icon"><UserRound size={18} /><input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ahmed" dir="ltr" autoCapitalize="none" spellCheck={false} /></div></label>
              </>
            ) : (
              <label className="field"><span>{t("email")}</span><div className="input-with-icon"><Mail size={18} /><input type="email" required autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setResetSent(false); }} dir="ltr" /></div></label>
            )}
            <label className="field"><span>{t("password")}</span><div className="input-with-icon"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
            {mode === "owner" && (resetSent ? (
              <div className="banner ok" role="status">{t("resetSent")}</div>
            ) : (
              <button type="button" className="link-button" onClick={sendReset} disabled={busy}>{t("forgot")}</button>
            ))}
            <button className="btn primary wide login-submit" disabled={busy} type="submit">{busy ? t("submitting") : t("submit")}<Arrow size={18} /></button>
            <div className="session-note"><CheckCircle2 size={16} /><span>{t("sessionSaved")}</span></div>
          </div>
          <p className="login-help">{t("help")}</p>
        </form>
      </section>
    </main>
  );
}
