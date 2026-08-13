"use client";
import { useEffect, useState, createContext, useContext } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, PROPERTY_SLUG } from "../lib/supabase";
import { useOffline } from "../lib/offline";

const Ctx = createContext(null);
export const useProperty = () => useContext(Ctx);

const NAV = [
  { href: "/", label: "اليوم", ico: "🔑" },
  { href: "/new-booking", label: "حجز", ico: "＋" },
  { href: "/bookings", label: "الحجوزات", ico: "📋" },
  { href: "/housekeeping", label: "النضافة", ico: "🧹" },
  { href: "/reports", label: "التقارير", ico: "📊" },
  { href: "/settings", label: "الإعدادات", ico: "⚙" },
];

// Roles decide what's even reachable. Housekeepers don't see money.
const ALLOWED = {
  owner:        ["/", "/new-booking", "/bookings", "/housekeeping", "/reports", "/settings"],
  manager:      ["/", "/new-booking", "/bookings", "/housekeeping", "/reports", "/settings"],
  reception:    ["/", "/new-booking", "/bookings", "/housekeeping"],
  housekeeping: ["/housekeeping"],
};

export default function Shell({ children }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: property, error: pErr } = await supabase
        .from("properties")
        .select("*")
        .eq("slug", PROPERTY_SLUG)
        .maybeSingle();

      const { data: membership } = await supabase
        .from("property_members")
        .select("role, property_id")
        .eq("user_id", session.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (!alive) return;

      setState({
        loading: false,
        session,
        property,
        role: membership?.role || null,
        // RLS returns nothing rather than an error when you're not a member,
        // so an empty property is the signal, not pErr.
        denied: !property || !membership,
        error: pErr?.message,
      });
    }

    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) router.replace("/login");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [router]);

  if (state.loading) {
    return <div className="center-page"><p style={{ color: "var(--muted)" }}>لحظة…</p></div>;
  }

  if (state.denied) {
    return (
      <div className="center-page">
        <div className="card" style={{ maxWidth: 400 }}>
          <h2 style={{ marginBottom: 8 }}>الحساب مش مربوط بفندق</h2>
          <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
            الحساب اشتغل، بس لسه محدش أداله صلاحية على أي فندق. كلّم المدير
            عشان يضيفك من شاشة الإعدادات.
          </p>
          <button
            className="btn wide"
            style={{ marginTop: 14 }}
            onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
          >
            تسجيل خروج
          </button>
        </div>
      </div>
    );
  }

  const allowed = ALLOWED[state.role] || [];
  if (!allowed.includes(path)) {
    return (
      <Ctx.Provider value={state}>
        <div className="shell">
          <Bar state={state} router={router} />
          <StatusStrip />
          <div className="wrap">
            <div className="banner warn">
              الصفحة دي مش من صلاحيات دورك ({roleLabel(state.role)}).
            </div>
            <Link className="btn" href={allowed[0] || "/"}>روح للصفحة الرئيسية</Link>
          </div>
          <Nav path={path} allowed={allowed} />
        </div>
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={state}>
      <div className="shell">
        <Bar state={state} router={router} />
        <StatusStrip />
        <div className="wrap">{children}</div>
        <Nav path={path} allowed={allowed} />
      </div>
    </Ctx.Provider>
  );
}

// Reception writes times onto real paperwork, so the clock is always on
// screen rather than hidden behind a menu.
export function Clock() {
  const [now, setNow] = useState(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <div className="clock" aria-hidden="true" />;

  return (
    <div className="clock">
      <time className="clock-time mono" dateTime={now.toISOString()}>
        {now.toLocaleTimeString("ar-EG", {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
        })}
      </time>
      <span className="clock-date">
        {now.toLocaleDateString("ar-EG", {
          weekday: "long", day: "numeric", month: "long", year: "numeric",
        })}
      </span>
    </div>
  );
}

function StatusStrip() {
  const { online, pending, syncing, sync } = useOffline();

  if (online && pending === 0) return null;

  return (
    <div className={`strip ${online ? "" : "off"}`}>
      {!online && <span>مفيش نت — بتشتغل على آخر نسخة محفوظة.</span>}
      {pending > 0 && (
        <>
          <span>{pending} إجراء مستني الإرسال.</span>
          {online && (
            <button className="strip-btn" onClick={sync} disabled={syncing}>
              {syncing ? "بيرسل…" : "ابعت دلوقتي"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Bar({ state, router }) {
  const p = state.property;
  return (
    <header className="topbar" style={{ background: p?.primary_color || "var(--deep)" }}>
      <div className="brand">
        {p?.logo_url && <img src={p.logo_url} alt="" />}
        <div>
          <h1>{p?.name}</h1>
          <div className="who">{roleLabel(state.role)}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
        <Clock />
        <button
          className="btn sm"
          style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.35)" }}
          onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
        >
          خروج
        </button>
      </div>
    </header>
  );
}

function Nav({ path, allowed }) {
  return (
    <nav className="nav">
      {NAV.filter((n) => allowed.includes(n.href)).map((n) => (
        <Link key={n.href} href={n.href} data-active={path === n.href}>
          <span className="ico">{n.ico}</span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function roleLabel(r) {
  return { owner: "المالك", manager: "مدير", reception: "ريسبشن", housekeeping: "هاوس كيبينج" }[r] || "—";
}

export function Toast({ msg, bad }) {
  if (!msg) return null;
  return <div className={`toast ${bad ? "bad" : ""}`}>{msg}</div>;
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, bad = false) => {
    setToast({ msg, bad });
    setTimeout(() => setToast(null), 3200);
  };
  return [toast, show];
}
