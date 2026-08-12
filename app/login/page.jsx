"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/");
    });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Say what to do, not just what broke.
      setError(
        error.message.includes("Invalid login")
          ? "الإيميل أو الباسورد غلط. جرب تاني."
          : error.message.includes("Email not confirmed")
          ? "الحساب لسه محتاج تأكيد من الإيميل."
          : error.message
      );
      setBusy(false);
      return;
    }

    router.replace("/");
  }

  return (
    <div className="center-page">
      <form className="card" style={{ width: "100%", maxWidth: 360 }} onSubmit={submit}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--sea)", letterSpacing: ".1em" }}>
            EASYROOM
          </div>
          <h2 style={{ fontSize: 20, marginTop: 6 }}>تسجيل الدخول</h2>
        </div>

        {error && <div className="banner bad">{error}</div>}

        <div className="stack">
          <div className="field">
            <label htmlFor="email">الإيميل</label>
            <input
              id="email" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              dir="ltr" style={{ textAlign: "left" }}
            />
          </div>
          <div className="field">
            <label htmlFor="pw">الباسورد</label>
            <input
              id="pw" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              dir="ltr" style={{ textAlign: "left" }}
            />
          </div>
          <button className="btn primary wide" disabled={busy} type="submit">
            {busy ? "بيدخل…" : "دخول"}
          </button>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16, marginBottom: 0, lineHeight: 1.7 }}>
          الحسابات بيعملها المدير من شاشة الإعدادات. لو مش عارف بياناتك، كلّمه.
        </p>
      </form>
    </div>
  );
}
