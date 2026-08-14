"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Hotel, Languages, LockKeyhole, Mail, UserRound } from "lucide-react";
import { localePath, useAppLocale } from "../../lib/locale";
import { supabase, DEFAULT_PROPERTY_SLUG } from "../../lib/supabase";
import { isHotelSlug, isStaffUsername, normalizeHotelSlug, staffLoginEmail } from "../../lib/auth-login";
import { isReachableEmail, resetRedirectTo } from "../../lib/password-reset";

// A staff username is unique inside a hotel, not across them, so a sign-in
// has to say which hotel before anybody is signed in and the database can be
// asked. The device remembers it, so staff type it once and never again.
const HOTEL_KEY = "easyroom:login-hotel";

export default function Login() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const { switchLocale } = useAppLocale();
  const [mode, setMode] = useState("staff");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [hotel, setHotel] = useState(DEFAULT_PROPERTY_SLUG);
  const [showHotel, setShowHotel] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const savedMode = window.localStorage.getItem("easyroom-login-mode");
    if (savedMode === "owner" || savedMode === "staff") setMode(savedMode);
    const savedHotel = window.localStorage.getItem(HOTEL_KEY);
    if (savedHotel) {
      setHotel(savedHotel);
      // Somebody who has signed in to another hotel on this device keeps
      // seeing the field, because for them it is not an assumption any more.
      if (savedHotel !== DEFAULT_PROPERTY_SLUG) setShowHotel(true);
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(localePath("/", locale));
    });
  }, [locale, router]);

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
    if (mode === "staff" && !isStaffUsername(username)) {
      setError(t("usernameInvalid"));
      setBusy(false);
      return;
    }
    if (mode === "staff" && !isHotelSlug(hotel)) {
      setError(t("hotelInvalid"));
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
          <div className="login-heading"><span className="eyebrow">EASYROOM</span><h2 id="login-title">{t("title")}</h2><p>{t("subtitle")}</p></div>
          {error && <div className="banner bad" role="alert">{error}</div>}
          <div className="stack form-stack">
            <div className="login-mode-switch" role="tablist" aria-label={t("loginMethod")}>
              <button type="button" role="tab" aria-selected={mode === "staff"} onClick={() => { setMode("staff"); setError(null); }}><UserRound size={16} />{t("staffLogin")}</button>
              <button type="button" role="tab" aria-selected={mode === "owner"} onClick={() => { setMode("owner"); setError(null); }}><Mail size={16} />{t("ownerLogin")}</button>
            </div>
            {mode === "staff" ? (
              <>
                <label className="field"><span>{t("username")}</span><div className="input-with-icon"><UserRound size={18} /><input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ahmed" dir="ltr" /></div></label>
                {showHotel ? (
                  <label className="field"><span>{t("hotelCode")}</span><div className="input-with-icon"><Hotel size={18} /><input required autoComplete="organization" value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="greek-club-dahab" dir="ltr" /></div><span className="field-hint">{t("hotelCodeHint")}</span></label>
                ) : (
                  <button type="button" className="link-button" onClick={() => setShowHotel(true)}>{t("otherHotel")}</button>
                )}
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
