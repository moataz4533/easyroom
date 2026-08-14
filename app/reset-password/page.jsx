"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Languages, LockKeyhole,
} from "lucide-react";
import { localePath, useAppLocale } from "../../lib/locale";
import { supabase } from "../../lib/supabase";
import { MIN_PASSWORD, recoveryFrom, validateNewPassword } from "../../lib/password-reset";

/**
 * The end of the reset link from the owner's inbox.
 *
 * It sits outside the app shell on purpose: somebody arriving here is holding
 * a link, not a session they chose, and should be setting a password rather
 * than landing in the hotel's screens.
 */
export default function ResetPassword() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Reset");
  const common = useTranslations("Common");
  const { switchLocale } = useAppLocale();

  const [ready, setReady] = useState(null);   // null = still working it out
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    async function open() {
      const found = recoveryFrom({ hash: window.location.hash, search: window.location.search });

      if (found.kind === "error") {
        if (alive) { setReady(false); setError(found.message); }
        return;
      }
      if (found.kind === "code") {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(found.code);
        if (!alive) return;
        if (exchangeError) { setReady(false); setError(exchangeError.message); return; }
        setReady(true);
        return;
      }

      // The fragment form is picked up by the client as it starts, so the
      // question is simply whether a session exists by now.
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      setReady(Boolean(session));
    }
    open();
    return () => { alive = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    const problems = validateNewPassword(password, again);
    if (problems.length) {
      setError(t(problems[0]));
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }

    setDone(true);
    // Signed out deliberately, so the new password is used at least once and
    // is not merely something typed on a screen and forgotten.
    await supabase.auth.signOut();
    setTimeout(() => router.replace(localePath("/login", locale)), 1800);
  }

  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  return (
    <main className="auth-surface center-page">
      <button className="language-float" onClick={switchLocale}>
        <Languages size={17} />{common("language")}
      </button>
      <section className="login-shell" aria-labelledby="reset-title">
        <div className="login-brand-panel">
          <div className="brand-emblem">
            <Image src="/easyroom-logo.png" alt="Easyroom" width={48} height={48} priority />
          </div>
          <div>
            <span className="eyebrow">EASYROOM</span>
            <h1>{t("heroTitle")}</h1>
            <p>{t("heroBody")}</p>
          </div>
        </div>

        <form className="login-card" onSubmit={submit}>
          <div className="login-heading">
            <span className="eyebrow">EASYROOM</span>
            <h2 id="reset-title">{t("title")}</h2>
            <p>{t("subtitle")}</p>
          </div>

          {error && <div className="banner bad" role="alert">{error}</div>}

          {ready === null ? (
            <div className="empty">{common("loading")}</div>
          ) : done ? (
            <div className="banner ok" role="status">
              <CheckCircle2 size={16} /> {t("done")}
            </div>
          ) : ready === false ? (
            <div className="stack form-stack">
              <div className="banner warn">{t("linkExpired")}</div>
              <a className="btn primary wide" href={localePath("/login", locale)}>
                {t("backToLogin")}<Arrow size={18} />
              </a>
            </div>
          ) : (
            <div className="stack form-stack">
              <label className="field">
                <span>{t("newPassword")}</span>
                <div className="input-with-icon">
                  <LockKeyhole size={18} />
                  <input
                    type={showPassword ? "text" : "password"} required autoFocus
                    autoComplete="new-password" minLength={MIN_PASSWORD} dir="ltr"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <span className="field-hint">{t("rule", { count: MIN_PASSWORD })}</span>
              </label>

              <label className="field">
                <span>{t("again")}</span>
                <div className="input-with-icon">
                  <LockKeyhole size={18} />
                  <input
                    type={showPassword ? "text" : "password"} required
                    autoComplete="new-password" minLength={MIN_PASSWORD} dir="ltr"
                    value={again} onChange={(e) => setAgain(e.target.value)}
                  />
                </div>
              </label>

              <button className="btn primary wide login-submit" disabled={busy} type="submit">
                {busy ? t("saving") : t("save")}<Arrow size={18} />
              </button>
            </div>
          )}

          <p className="login-help">{t("staffNote")}</p>
        </form>
      </section>
    </main>
  );
}
