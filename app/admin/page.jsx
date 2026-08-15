"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Building2, KeyRound, Power, RefreshCw, ShieldAlert, UserPlus,
} from "lucide-react";
import { supabase, dayLabel } from "../../lib/supabase";
import { localePath } from "../../lib/locale";
import { Toast, useToast } from "../../components/Shell";
import {
  membersOf, isDormant, neverSignedIn, newHotelProblems, normaliseCode,
  platformTotals, staffAddressExample, suggestCode, summariseProperty,
} from "../../lib/platform";

const FUNCTION_URL = "https://huvbguyvgptmplqbcbdp.supabase.co/functions/v1/platform-admin";

/**
 * The platform console.
 *
 * Deliberately outside Shell: Shell is built around one hotel, and this is
 * the screen about all of them. It is not linked from anywhere either —
 * reachable by typing the address, which is not the security (the security
 * is that every call below is refused for anyone not in platform_admins)
 * but does keep it out of the way of people it is not for.
 */
export default function Page() {
  const locale = useLocale();
  const t = useTranslations("Platform");
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { if (alive) setAllowed(false); return; }
      const { data } = await supabase.rpc("is_platform_admin");
      if (alive) setAllowed(data === true);
    })();
    return () => { alive = false; };
  }, []);

  if (allowed === null) return <main className="wrap"><div className="empty">{t("checking")}</div></main>;

  if (!allowed) {
    return (
      <main className="wrap">
        <div className="card access-card">
          <div className="empty-icon"><ShieldAlert size={23} /></div>
          <h2>{t("forbidden")}</h2>
          <Link className="btn primary" href={localePath("/", locale)}>{t("backToApp")}</Link>
        </div>
      </main>
    );
  }

  return <Console />;
}

function Console() {
  const locale = useLocale();
  const t = useTranslations("Platform");
  const [toast, showToast] = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const call = useCallback(async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const out = await call({ action: "overview" });
    setLoading(false);
    if (out.error) return showToast(out.error, true);
    setData(out);
  }, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(
    () => platformTotals(data?.properties || [], data?.members || []),
    [data]
  );

  return (
    <main className="wrap">
      <Toast {...(toast || {})} />

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t("subtitle")}</span>
          <h1>{t("title")}</h1>
        </div>
        <button className="btn dashboard-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />{t("refresh")}
        </button>
      </div>

      <div className="platform-totals">
        <Total label={t("totalHotels")} value={totals.hotels} sub={`${totals.liveHotels} ${t("liveHotels")}`} />
        <Total label={t("totalAccounts")} value={totals.accounts} sub={`${totals.activeAccounts} ${t("activeAccounts")}`} />
        <Total label={t("neverUsed")} value={totals.neverUsed} tone={totals.neverUsed > 0 ? "warn" : null} />
        <Total label={t("totalRooms")} value={totals.rooms} />
        <Total label={t("totalBookings")} value={totals.bookings} />
      </div>

      <NewHotel
        taken={(data?.properties || []).map((property) => property.slug)}
        onCreate={call}
        onDone={(name) => { showToast(t("created", { name })); load(); }}
        onError={(message) => showToast(message, true)}
      />

      <section className="section">
        <h2>{t("hotels")}</h2>
        {loading && !data ? (
          <div className="empty">{t("loading")}</div>
        ) : (data?.properties || []).length === 0 ? (
          <div className="empty">{t("noHotels")}</div>
        ) : (
          <div className="stack">
            {(data?.properties || []).map((property) => (
              <HotelCard
                key={property.id}
                summary={summariseProperty(property, data.members)}
                members={membersOf(data.members, property.id)}
                locale={locale}
                call={call}
                onChanged={load}
                onError={(message) => showToast(message, true)}
                onSaid={(message) => showToast(message)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Total({ label, value, sub, tone }) {
  return (
    <div className="platform-total card" data-tone={tone}>
      <span>{label}</span>
      <strong className="mono">{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/* ------------------------------------------------------------ one hotel */

function HotelCard({ summary, members, locale, call, onChanged, onError, onSaid }) {
  const t = useTranslations("Platform");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggleHotel() {
    setBusy(true);
    const out = await call({ action: "set_property_active", property_id: summary.id });
    setBusy(false);
    setAsking(false);
    if (out.error) return onError(out.error);
    onSaid(out.is_active ? t("hotelResumed") : t("hotelSuspended"));
    onChanged();
  }

  return (
    <div className="card stack" data-suspended={!summary.active}>
      <div className="spread">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <Building2 size={18} />
            <strong style={{ fontSize: 16 }}>{summary.name}</strong>
            <span className={`pill ${summary.active ? "ok" : "bad"}`}>
              {summary.active ? t("live") : t("suspended")}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            <span className="code">{summary.slug}</span>{" "}
            {t("counts", { rooms: summary.rooms, bookings: summary.bookings, guests: summary.guests })}
            {summary.createdAt && ` · ${t("since", { date: dayLabel(String(summary.createdAt).slice(0, 10), locale) })}`}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {summary.owner
              ? t("ownerIs", { name: summary.owner.full_name || summary.owner.email || "—" })
              : t("noOwner")}
          </div>
        </div>
        {!asking && (
          <button className={`btn sm ${summary.active ? "danger" : ""}`}
            onClick={() => (summary.active ? setAsking(true) : toggleHotel())} disabled={busy}>
            <Power size={15} />{summary.active ? t("suspend") : t("resume")}
          </button>
        )}
      </div>

      {!summary.active && <div className="banner warn" style={{ margin: 0 }}>{t("suspendedNote")}</div>}

      {asking && (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <strong style={{ fontSize: 14 }}>{t("confirmSuspendTitle", { name: summary.name })}</strong>
          <p className="section-note" style={{ margin: 0 }}>{t("confirmSuspendBody")}</p>
          <div className="row">
            <button className="btn danger grow" onClick={toggleHotel} disabled={busy}>
              {t("confirmSuspend")}
            </button>
            <button className="btn" onClick={() => setAsking(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      <div>
        <div className="spread" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>{t("accounts")}</strong>
          <span className="pill">{summary.activeMembers}/{summary.members}</span>
        </div>
        {members.length === 0 ? (
          <div className="empty compact-empty">{t("noAccounts")}</div>
        ) : (
          <div className="stack">
            {members.map((member) => (
              <AccountRow key={member.id} member={member} locale={locale}
                call={call} onChanged={onChanged} onError={onError} onSaid={onSaid} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountRow({ member, locale, call, onChanged, onError, onSaid }) {
  const t = useTranslations("Platform");
  const roles = useTranslations("Roles");
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function toggle() {
    setBusy(true);
    const out = await call({ action: "set_member_active", member_id: member.id });
    setBusy(false);
    if (out.error) return onError(out.error);
    onSaid(out.is_active ? t("accountActivated") : t("accountDeactivated"));
    onChanged();
  }

  async function reset() {
    setBusy(true);
    const out = await call({ action: "reset_password", member_id: member.id, password });
    setBusy(false);
    if (out.error) return onError(out.error);
    setResetting(false);
    setPassword("");
    onSaid(t("passwordChanged"));
  }

  return (
    <div className="card" style={{ background: "var(--surface-2)", padding: "10px 12px" }}>
      <div className="spread">
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{member.full_name || "—"}</span>
            <span className="pill">{roles(member.role)}</span>
            {!member.is_active && <span className="pill bad">{t("suspended")}</span>}
            {neverSignedIn(member) && <span className="pill warn">{t("neverSignedIn")}</span>}
            {isDormant(member, today) && <span className="pill warn">{t("dormant")}</span>}
          </div>
          {/* An email reads left-to-right inside a right-to-left card, and a
              username may be either; dir="auto" lets the text decide. */}
          <div dir="auto" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, overflowWrap: "anywhere" }}>
            {member.login_username || member.email || "—"}
            {member.last_sign_in_at &&
              ` · ${t("lastSeen", { date: dayLabel(member.last_sign_in_at.slice(0, 10), locale) })}`}
          </div>
        </div>
        <div className="row" style={{ flex: "none" }}>
          <button className="btn sm" onClick={() => setResetting((open) => !open)} disabled={busy}>
            <KeyRound size={14} />{t("resetPassword")}
          </button>
          <button className={`btn sm ${member.is_active ? "danger" : ""}`} onClick={toggle} disabled={busy}>
            {member.is_active ? t("deactivate") : t("activate")}
          </button>
        </div>
      </div>

      {resetting && (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field grow">
            <label htmlFor={`pw-${member.id}`}>{t("newPassword")}</label>
            <input id={`pw-${member.id}`} type="password" dir="ltr" autoComplete="new-password"
              value={password} placeholder={t("passwordPlaceholder")}
              onChange={(event) => setPassword(event.target.value)} />
          </div>
          <button className="btn primary" style={{ alignSelf: "flex-end" }}
            disabled={busy || password.length < 8} onClick={reset}>
            {t("apply")}
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- a new hotel */

function NewHotel({ taken, onCreate, onDone, onError }) {
  const t = useTranslations("Platform");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", name_en: "", code: "", codeTouched: false,
    timezone: "Africa/Cairo",
    ownerName: "", ownerEmail: "", password: "", again: "",
  });

  const set = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  // The code follows the name until somebody edits it, then it is theirs.
  const setName = (event) => setForm((current) => ({
    ...current,
    name: event.target.value,
    code: current.codeTouched ? current.code : suggestCode(event.target.value),
  }));

  const setCode = (event) => setForm((current) => ({
    ...current, code: normaliseCode(event.target.value), codeTouched: true,
  }));

  const problems = newHotelProblems(form, taken);

  async function create() {
    if (problems.length) return onError(t(`problem_${problems[0]}`));
    setBusy(true);
    const out = await onCreate({
      action: "create_property",
      name: form.name, name_en: form.name_en, slug: form.code, timezone: form.timezone,
      owner_name: form.ownerName, owner_email: form.ownerEmail, owner_password: form.password,
    });
    setBusy(false);
    if (out.error) return onError(out.error);
    setForm({
      name: "", name_en: "", code: "", codeTouched: false, timezone: "Africa/Cairo",
      ownerName: "", ownerEmail: "", password: "", again: "",
    });
    setOpen(false);
    onDone(form.name);
  }

  if (!open) {
    return (
      <button className="btn primary wide" style={{ marginBottom: 18 }} onClick={() => setOpen(true)}>
        <UserPlus size={16} />{t("openHotel")}
      </button>
    );
  }

  return (
    <section className="card stack" style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 15, margin: 0 }}>{t("openHotel")}</h2>
      <p className="section-note" style={{ margin: 0 }}>{t("openHotelNote")}</p>

      <div className="row">
        <div className="field grow">
          <label htmlFor="hotel-name">{t("hotelName")}</label>
          <input id="hotel-name" value={form.name} onChange={setName} autoFocus />
        </div>
        <div className="field grow">
          <label htmlFor="hotel-name-en">{t("hotelNameEn")}</label>
          <input id="hotel-name-en" dir="ltr" value={form.name_en} onChange={set("name_en")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="hotel-code">{t("code")}</label>
        <input id="hotel-code" className="mono" dir="ltr" style={{ textAlign: "left" }}
          value={form.code} onChange={setCode} />
        <p className="field-hint">{t("codeHint")}</p>
        {/* The code cannot change afterwards without locking every staff
            member out, so its consequence is shown while it is being typed. */}
        {form.code && (
          <p className="field-hint mono" dir="ltr" style={{ textAlign: "start" }}>
            {t("addressPreview", { address: staffAddressExample(form.code) })}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="hotel-tz">{t("timezone")}</label>
        <input id="hotel-tz" className="mono" dir="ltr" style={{ textAlign: "left" }}
          value={form.timezone} onChange={set("timezone")} />
      </div>

      <div className="row">
        <div className="field grow">
          <label htmlFor="owner-name">{t("ownerName")}</label>
          <input id="owner-name" value={form.ownerName} onChange={set("ownerName")} />
        </div>
        <div className="field grow">
          <label htmlFor="owner-email">{t("ownerEmail")}</label>
          <input id="owner-email" type="email" dir="ltr" style={{ textAlign: "left" }}
            value={form.ownerEmail} onChange={set("ownerEmail")} />
        </div>
      </div>

      <div className="row">
        <div className="field grow">
          <label htmlFor="owner-pw">{t("ownerPassword")}</label>
          <input id="owner-pw" type="password" dir="ltr" autoComplete="new-password"
            value={form.password} placeholder={t("passwordPlaceholder")} onChange={set("password")} />
        </div>
        <div className="field grow">
          <label htmlFor="owner-pw2">{t("ownerPasswordAgain")}</label>
          <input id="owner-pw2" type="password" dir="ltr" autoComplete="new-password"
            value={form.again} onChange={set("again")} />
        </div>
      </div>

      {problems.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>{t(`problem_${problems[0]}`)}</div>
      )}

      <div className="row">
        <button className="btn primary grow" disabled={busy || problems.length > 0} onClick={create}>
          {busy ? t("creating") : t("create")}
        </button>
        <button className="btn" onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
    </section>
  );
}
