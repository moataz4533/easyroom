"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import {
  BadgeCheck, Building2, CalendarClock, Eraser, History, KeyRound, MessageCircle, Power,
  RefreshCw, ShieldAlert, Sparkles, UserPlus,
} from "lucide-react";
import { supabase, dayLabel } from "../../lib/supabase";
import { localePath } from "../../lib/locale";
import { formatNumber } from "../../lib/format";
import { Toast, useToast } from "../../components/Shell";
import {
  MEMBER_LOGINS, PLATFORM_ROLES, membersOf, isDormant, neverSignedIn, newHotelProblems,
  newMemberProblems, normaliseCode,
  platformTotals, resetProblem, staffAddressExample, suggestCode, summariseProperty,
} from "../../lib/platform";
import {
  DEFAULT_GRACE, DEFAULT_TRIAL_DAYS, EXTEND_MONTHS, LICENSE_KINDS, OPENING_CHOICES, PAY_METHODS,
  addDays, addMonths, extendProblem, licenseTone, licenseTotals, openingCalls, openingProblem,
  reminderKey, renewalEnd, setLicenseProblem,
} from "../../lib/licenses";
import { whatsappLink } from "../../lib/confirmation";

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
  const [licenses, setLicenses] = useState([]);
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
    // Licences come from the database rather than the edge function: they
    // are a table the edge function never knew about, and the same
    // is_platform_admin() check guards them there.
    const [out, licenceResult] = await Promise.all([
      call({ action: "overview" }),
      supabase.rpc("platform_licenses"),
    ]);
    setLoading(false);
    if (out.error) return showToast(out.error, true);
    if (licenceResult.error) showToast(licenceResult.error.message, true);
    setData(out);
    setLicenses(licenceResult.data || []);
  }, [call]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(
    () => platformTotals(data?.properties || [], data?.members || []),
    [data]
  );
  const licenceTotals = useMemo(() => licenseTotals(licenses), [licenses]);
  const licenceOf = useMemo(
    () => Object.fromEntries(licenses.map((row) => [row.property_id, row])),
    [licenses]
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
        <Total label={t("totalHotels")} value={totals.hotels} sub={`${formatNumber(totals.liveHotels, locale)} ${t("liveHotels")}`} />
        <Total label={t("totalAccounts")} value={totals.accounts} sub={`${formatNumber(totals.activeAccounts, locale)} ${t("activeAccounts")}`} />
        <Total label={t("neverUsed")} value={totals.neverUsed} tone={totals.neverUsed > 0 ? "warn" : null} />
        <Total label={t("totalRooms")} value={totals.rooms} />
        <Total label={t("totalBookings")} value={totals.bookings} />
      </div>

      <div className="platform-totals">
        <Total label={t("licExpiringTotal")} value={licenceTotals.expiring + licenceTotals.grace}
          sub={licenceTotals.grace > 0 ? t("licInGrace", { count: licenceTotals.grace }) : null}
          tone={licenceTotals.expiring + licenceTotals.grace > 0 ? "warn" : null} />
        <Total label={t("licExpiredTotal")} value={licenceTotals.expired}
          tone={licenceTotals.expired > 0 ? "bad" : null} />
        <Total label={t("licTrialsTotal")} value={licenceTotals.trials} />
        <Total label={t("licPaidThisYear")} value={licenceTotals.paidThisYear}
          sub={t("licPaidTotal", { amount: formatNumber(licenceTotals.paidTotal, locale) })} />
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
                license={licenceOf[property.id]}
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
  const locale = useLocale();
  return (
    <div className="platform-total card" data-tone={tone}>
      <span>{label}</span>
      <strong className="mono">{formatNumber(value, locale)}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/* ------------------------------------------------------------ one hotel */

function HotelCard({ summary, license, members, locale, call, onChanged, onError, onSaid }) {
  const t = useTranslations("Platform");
  const [asking, setAsking] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * A hotel opened from here arrives with no rooms and no prices, so the
   * first person to log in cannot take a booking or show anybody anything.
   * The offer only appears while that is still true.
   */
  const bare = summary.rooms === 0 && summary.bookings === 0;

  async function fillDemo() {
    setBusy(true);
    const { error } = await supabase.rpc("seed_demo_property", { p_property: summary.id });
    setBusy(false);
    if (error) return onError(error.message);
    onSaid(t("demoFilled", { name: summary.name }));
    onChanged();
  }

  async function toggleHotel() {
    setBusy(true);
    const out = await call({ action: "set_property_active", property_id: summary.id });
    setBusy(false);
    setAsking(false);
    if (out.error) return onError(out.error);
    onSaid(out.is_active ? t("hotelResumed") : t("hotelSuspended"));
    onChanged();
  }

  /**
   * Emptying the register. This one does not go through the edge function:
   * it is a single database function, so the six deletes and the checks
   * that the setup survived them are one transaction. An interrupted reset
   * cannot leave a hotel with guests and no bookings.
   */
  async function resetData() {
    const problem = resetProblem(typed, summary.slug);
    if (problem) return onError(t(problem));

    setBusy(true);
    const { data: out, error } = await supabase.rpc("reset_property_data", {
      p_property: summary.id, p_confirm: typed,
    });
    setBusy(false);
    if (error) return onError(error.message);

    setWiping(false);
    setTyped("");
    onSaid(t("resetDone", {
      bookings: Number(out?.deleted?.bookings) || 0,
      guests: Number(out?.deleted?.guests) || 0,
    }));
    onChanged();
  }

  return (
    <div className="card stack" data-suspended={!summary.active}>
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 220 }}>
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
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {bare && (
              <button className="btn sm primary" onClick={fillDemo} disabled={busy}>
                <Sparkles size={15} />{t("fillDemo")}
              </button>
            )}
            <button className="btn sm" onClick={() => setWiping((open) => !open)} disabled={busy}>
              <Eraser size={15} />{t("resetData")}
            </button>
            <button className={`btn sm ${summary.active ? "danger" : ""}`}
              onClick={() => (summary.active ? setAsking(true) : toggleHotel())} disabled={busy}>
              <Power size={15} />{summary.active ? t("suspend") : t("resume")}
            </button>
          </div>
        )}
      </div>

      {wiping && (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <strong style={{ fontSize: 14 }}>{t("resetTitle", { name: summary.name })}</strong>
          <p className="section-note" style={{ margin: 0 }}>
            {t("resetGoes", { bookings: summary.bookings, guests: summary.guests })}
          </p>
          <p className="section-note" style={{ margin: 0 }}>{t("resetStays")}</p>
          {/* Said here rather than in a note somewhere: on the free plan the
              only copy of this hotel is the one somebody downloaded. */}
          <div className="banner warn" style={{ margin: 0 }}>{t("resetBackupFirst")}</div>
          <div className="field">
            <label htmlFor={`wipe-${summary.id}`}>{t("resetTypeCode", { code: summary.slug })}</label>
            <input id={`wipe-${summary.id}`} className="mono" dir="ltr" style={{ textAlign: "left" }}
              autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn danger grow" onClick={resetData}
              disabled={busy || resetProblem(typed, summary.slug) !== null}>
              {busy ? t("resetting") : t("resetConfirm")}
            </button>
            <button className="btn" onClick={() => { setWiping(false); setTyped(""); }}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {bare && summary.active && (
        <div className="banner" style={{ margin: 0 }}>{t("bareHotel")}</div>
      )}

      {!summary.active && <div className="banner warn" style={{ margin: 0 }}>{t("suspendedNote")}</div>}

      {license && (
        <LicensePanel key={`${license.kind}|${license.ends_on}|${license.grace_days}`}
          license={license} hotel={summary} locale={locale}
          onChanged={onChanged} onError={onError} onSaid={onSaid} />
      )}

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
          <div className="row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{t("accounts")}</strong>
            <span className="pill">{formatNumber(summary.activeMembers, locale)}/{formatNumber(summary.members, locale)}</span>
          </div>
          <button className={`btn sm ${adding ? "primary" : ""}`} onClick={() => setAdding((open) => !open)}>
            <UserPlus size={14} />{t("addMember")}
          </button>
        </div>
        {adding && (
          <AddMember hotel={summary} call={call}
            onDone={(message) => { setAdding(false); onSaid(message); onChanged(); }}
            onCancel={() => setAdding(false)} onError={onError} />
        )}
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

/* -------------------------------------------------------- its licence */

/**
 * A licence date always carries its year. "Runs until 20 October" after a
 * twelve-month renewal reads as if nothing happened.
 */
const licDay = (iso, locale) => dayLabel(iso, locale, { day: "numeric", month: "short", year: "numeric" });

/**
 * How long a hotel may use the app, and what it has paid for that.
 *
 * Renewing is the everyday action and comes first; "set" is for the rest —
 * a longer trial, a specific date, an open-ended licence, a different grace
 * period. Every change goes through a database function that writes it
 * down, so the history below is the record, not a log somebody may forget.
 */
function LicensePanel({ license, hotel, locale, onChanged, onError, onSaid }) {
  const t = useTranslations("Platform");
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [extend, setExtend] = useState({ months: 12, amount: "", currency: "EGP", method: "cash", note: "" });
  const [setting, setSetting] = useState(() => ({
    kind: license.kind,
    endsOn: license.ends_on || addMonths(license.today, 12),
    grace: String(license.grace_days ?? DEFAULT_GRACE),
    note: "",
  }));

  const state = license.state;
  const left = Number(license.days_left);
  const graceUntil = license.ends_on ? addDays(license.ends_on, license.grace_days) : null;
  const preview = renewalEnd(license, extend.months);
  const extendIssue = extendProblem(extend);
  const setIssue = setLicenseProblem(setting);

  function toggle(next) {
    setMode((current) => (current === next ? null : next));
    if (next === "history" && history === null) loadHistory();
  }

  async function loadHistory() {
    const { data, error } = await supabase.rpc("platform_license_history", { p_property: hotel.id });
    if (error) return onError(error.message);
    setHistory(data || []);
  }

  async function renew() {
    if (extendIssue) return onError(t(`licProblem_${extendIssue}`));
    setBusy(true);
    const { data, error } = await supabase.rpc("platform_extend_license", {
      p_property: hotel.id,
      p_months: Number(extend.months),
      p_amount: extend.amount === "" ? null : Number(extend.amount),
      p_currency: extend.currency || "EGP",
      p_method: extend.method || null,
      p_note: extend.note || null,
    });
    setBusy(false);
    if (error) return onError(error.message);
    onSaid(t("licRenewed", { name: hotel.name, date: licDay(data?.ends_on || preview, locale) }));
    setMode(null);
    setHistory(null);
    setExtend((current) => ({ ...current, amount: "", note: "" }));
    onChanged();
  }

  async function save() {
    if (setIssue) return onError(t(`licProblem_${setIssue}`));
    setBusy(true);
    const { error } = await supabase.rpc("platform_set_license", {
      p_property: hotel.id,
      p_kind: setting.kind,
      p_ends_on: setting.kind === "unlimited" ? null : setting.endsOn,
      p_grace_days: setting.grace === "" ? null : Number(setting.grace),
      p_note: setting.note || null,
    });
    setBusy(false);
    if (error) return onError(error.message);
    onSaid(t("licSaved", { name: hotel.name }));
    setMode(null);
    setHistory(null);
    onChanged();
  }

  // The owner's own number when the panel has one; otherwise WhatsApp opens
  // with the message ready and asks who to send it to.
  const remind = reminderKey(state);
  const ownerPhone = hotel.owner?.phone || "";
  const remindText = remind ? t(remind, {
    owner: hotel.owner?.full_name || "",
    hotel: hotel.name,
    date: licDay(license.ends_on, locale),
    until: licDay(graceUntil, locale),
  }) : "";
  const remindHref = remind
    ? whatsappLink(ownerPhone, remindText) || `https://wa.me/?text=${encodeURIComponent(remindText)}`
    : null;

  const when = !license.ends_on
    ? t("licNoEnd")
    : state === "expired"
      ? t("licLockedSince", { date: licDay(addDays(graceUntil, 1), locale) })
      : state === "grace"
        ? t("licGraceLine", { date: licDay(license.ends_on, locale), until: licDay(graceUntil, locale) })
        : t("licEndsLine", { date: licDay(license.ends_on, locale), days: left });

  return (
    <div className="license-box" data-tone={licenseTone(state)}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <BadgeCheck size={16} />
            <strong style={{ fontSize: 13 }}>{t("license")}</strong>
            <span className="pill">{t(`licKind_${license.kind}`)}</span>
            <span className={`pill ${licenseTone(state)}`}>{t(`licState_${state}`)}</span>
            {!license.explicit && <span className="pill warn">{t("licImplicit")}</span>}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{when}</div>
          {Number(license.paid_total) > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {t("licPaidLine", {
                total: formatNumber(Number(license.paid_total), locale),
                year: formatNumber(Number(license.paid_this_year), locale),
              })}
              {license.last_paid_on && ` · ${t("licLastPaid", { date: licDay(license.last_paid_on, locale) })}`}
            </div>
          )}
          {license.notes && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{license.notes}</div>
          )}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {remindHref && (
            <a className="btn sm" href={remindHref} target="_blank" rel="noreferrer"
              title={ownerPhone ? t("remindTo", { phone: ownerPhone }) : t("remindNoPhone")}>
              <MessageCircle size={14} />{t("remind")}
            </a>
          )}
          <button className={`btn sm ${mode === "extend" ? "primary" : ""}`} onClick={() => toggle("extend")} disabled={busy}>
            <CalendarClock size={14} />{t("licRenew")}
          </button>
          <button className={`btn sm ${mode === "set" ? "primary" : ""}`} onClick={() => toggle("set")} disabled={busy}>
            {t("licEdit")}
          </button>
          <button className={`btn sm ${mode === "history" ? "primary" : ""}`} onClick={() => toggle("history")} disabled={busy}>
            <History size={14} />{t("licHistory")}
          </button>
        </div>
      </div>

      {mode === "extend" && (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="field">
            <span>{t("licMonths")}</span>
            <div className="tabs" role="tablist">
              {EXTEND_MONTHS.map((months) => (
                <button key={months} type="button" className="tab" role="tab"
                  aria-selected={Number(extend.months) === months}
                  onClick={() => setExtend((current) => ({ ...current, months }))}>
                  {t("licMonthsN", { count: months })}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor={`lic-m-${hotel.id}`}>{t("licCustomMonths")}</label>
              <input id={`lic-m-${hotel.id}`} type="number" min="1" max="60" inputMode="numeric"
                value={extend.months}
                onChange={(event) => setExtend((current) => ({ ...current, months: event.target.value }))} />
            </div>
            <div className="field grow">
              <label htmlFor={`lic-a-${hotel.id}`}>{t("licAmount")}</label>
              <input id={`lic-a-${hotel.id}`} type="number" min="0" inputMode="decimal"
                value={extend.amount} placeholder="0"
                onChange={(event) => setExtend((current) => ({ ...current, amount: event.target.value }))} />
            </div>
            <div className="field" style={{ width: 90 }}>
              <label htmlFor={`lic-c-${hotel.id}`}>{t("licCurrency")}</label>
              <input id={`lic-c-${hotel.id}`} dir="ltr" value={extend.currency}
                onChange={(event) => setExtend((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
            </div>
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor={`lic-p-${hotel.id}`}>{t("licMethod")}</label>
              <select id={`lic-p-${hotel.id}`} value={extend.method}
                onChange={(event) => setExtend((current) => ({ ...current, method: event.target.value }))}>
                {PAY_METHODS.map((method) => (
                  <option key={method} value={method}>{t(`licMethod_${method}`)}</option>
                ))}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor={`lic-n-${hotel.id}`}>{t("licNote")}</label>
              <input id={`lic-n-${hotel.id}`} value={extend.note}
                onChange={(event) => setExtend((current) => ({ ...current, note: event.target.value }))} />
            </div>
          </div>
          {extendIssue ? (
            <div className="banner warn" style={{ margin: 0 }}>{t(`licProblem_${extendIssue}`)}</div>
          ) : (
            <div className="banner" style={{ margin: 0 }}>
              {t("licPreview", { date: licDay(preview, locale) })}
              {" "}{state === "expired" || !license.ends_on ? t("licFromToday") : t("licFromEnd")}
            </div>
          )}
          <div className="row">
            <button className="btn primary grow" onClick={renew} disabled={busy || extendIssue !== null}>
              {busy ? t("licSaving") : t("licRenewConfirm")}
            </button>
            <button className="btn" onClick={() => setMode(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {mode === "set" && (
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="field">
            <span>{t("licKind")}</span>
            <div className="tabs" role="tablist">
              {LICENSE_KINDS.map((kind) => (
                <button key={kind} type="button" className="tab" role="tab"
                  aria-selected={setting.kind === kind}
                  onClick={() => setSetting((current) => ({ ...current, kind }))}>
                  {t(`licKind_${kind}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            {setting.kind !== "unlimited" && (
              <div className="field grow">
                <label htmlFor={`lic-e-${hotel.id}`}>{t("licEndsOn")}</label>
                <input id={`lic-e-${hotel.id}`} type="date" dir="ltr" value={setting.endsOn || ""}
                  onChange={(event) => setSetting((current) => ({ ...current, endsOn: event.target.value }))} />
              </div>
            )}
            <div className="field grow">
              <label htmlFor={`lic-g-${hotel.id}`}>{t("licGrace")}</label>
              <input id={`lic-g-${hotel.id}`} type="number" min="0" max="60" inputMode="numeric"
                value={setting.grace}
                onChange={(event) => setSetting((current) => ({ ...current, grace: event.target.value }))} />
            </div>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>{t("licGraceHint")}</p>
          <div className="field">
            <label htmlFor={`lic-sn-${hotel.id}`}>{t("licNote")}</label>
            <input id={`lic-sn-${hotel.id}`} value={setting.note}
              onChange={(event) => setSetting((current) => ({ ...current, note: event.target.value }))} />
          </div>
          {setIssue && <div className="banner warn" style={{ margin: 0 }}>{t(`licProblem_${setIssue}`)}</div>}
          <div className="row">
            <button className="btn primary grow" onClick={save} disabled={busy || setIssue !== null}>
              {busy ? t("licSaving") : t("licSave")}
            </button>
            <button className="btn" onClick={() => setMode(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {mode === "history" && (
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          {history === null ? (
            <div className="empty compact-empty">{t("loading")}</div>
          ) : history.length === 0 ? (
            <div className="empty compact-empty">{t("licNoHistory")}</div>
          ) : history.map((event) => (
            <div key={event.id} className="license-event">
              <div className="spread">
                <strong>
                  {event.kind === "extended"
                    ? t("licEvent_extended", { count: event.months || 0 })
                    : t(`licEvent_${event.kind}`, { kind: t(`licKind_${event.new_kind || "trial"}`) })}
                </strong>
                <span>{licDay(String(event.created_at).slice(0, 10), locale)}</span>
              </div>
              <div>
                {event.new_end
                  ? t("licEventEnd", { date: licDay(event.new_end, locale) })
                  : t("licNoEnd")}
                {Number(event.amount) > 0 &&
                  ` · ${formatNumber(Number(event.amount), locale)} ${event.currency || ""}`}
                {event.method && ` · ${PAY_METHODS.includes(event.method) ? t(`licMethod_${event.method}`) : event.method}`}
                {event.actor_name && ` · ${event.actor_name}`}
              </div>
              {event.note && <div className="muted">{event.note}</div>}
            </div>
          ))}
        </div>
      )}
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

  async function changeRole(role) {
    setBusy(true);
    const out = await call({ action: "set_member_role", member_id: member.id, role });
    setBusy(false);
    if (out.error) return onError(out.error);
    onSaid(t("roleChanged", { name: member.full_name || "—", role: roles(role) }));
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
            <select className="role-select" value={member.role} disabled={busy}
              aria-label={t("memberRole")} onChange={(event) => changeRole(event.target.value)}>
              {PLATFORM_ROLES.map((role) => <option key={role} value={role}>{roles(role)}</option>)}
            </select>
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

/* ------------------------------------------- somebody added to a hotel */

const EMPTY_MEMBER = {
  fullName: "", phone: "", role: "manager", login: "username",
  username: "", email: "", password: "", again: "",
};

/**
 * Adding a manager (or an owner, or anyone) to a hotel that exists. A
 * username is the default because it is how everybody at a hotel already
 * signs in; an email is for an account somebody has, or should have,
 * outside it — and if that address is already an account, the form says
 * whose and asks again rather than quietly ignoring the password typed.
 */
function AddMember({ hotel, call, onDone, onCancel, onError }) {
  const t = useTranslations("Platform");
  const roles = useTranslations("Roles");
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [existing, setExisting] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "email" || field === "login") setExisting(null);
  };

  const problems = newMemberProblems(form, { linking: Boolean(existing) });
  const address = form.login === "username" && form.username
    ? staffAddressExample(hotel.slug, form.username.trim().toLowerCase())
    : "";

  async function submit() {
    if (problems.length) return onError(t(`problem_${problems[0]}`));
    setBusy(true);
    const out = await call({
      action: "add_member",
      property_id: hotel.id,
      role: form.role,
      full_name: form.fullName,
      phone: form.phone,
      login: form.login,
      username: form.username,
      email: form.email,
      password: existing ? "" : form.password,
      link_existing: Boolean(existing),
    });
    setBusy(false);
    if (out.code === "exists") { setExisting(out.name || form.email); return; }
    if (out.error) return onError(out.error);
    onDone(out.linked
      ? t("memberLinked", { name: form.fullName, hotel: hotel.name })
      : t("memberAdded", { name: form.fullName, hotel: hotel.name }));
  }

  return (
    <div className="card stack" style={{ background: "var(--paper)", marginBottom: 8 }}>
      <strong style={{ fontSize: 14 }}>{t("addMemberTitle", { name: hotel.name })}</strong>

      <div className="row">
        <div className="field grow">
          <label htmlFor={`mn-${hotel.id}`}>{t("memberName")}</label>
          <input id={`mn-${hotel.id}`} value={form.fullName} onChange={set("fullName")} autoFocus />
        </div>
        <div className="field grow">
          <label htmlFor={`mp-${hotel.id}`}>{t("memberPhone")}</label>
          <input id={`mp-${hotel.id}`} dir="ltr" inputMode="tel" value={form.phone} onChange={set("phone")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`mr-${hotel.id}`}>{t("memberRole")}</label>
        <select id={`mr-${hotel.id}`} value={form.role} onChange={set("role")}>
          {PLATFORM_ROLES.map((role) => <option key={role} value={role}>{roles(role)}</option>)}
        </select>
      </div>

      <div className="field">
        <span>{t("memberLogin")}</span>
        <div className="tabs" role="tablist">
          {MEMBER_LOGINS.map((login) => (
            <button key={login} type="button" className="tab" role="tab"
              aria-selected={form.login === login}
              onClick={() => { setForm((current) => ({ ...current, login })); setExisting(null); }}>
              {t(`memberLogin_${login}`)}
            </button>
          ))}
        </div>
      </div>

      {form.login === "username" ? (
        <div className="field">
          <label htmlFor={`mu-${hotel.id}`}>{t("memberUsername")}</label>
          <input id={`mu-${hotel.id}`} className="mono" dir="ltr" style={{ textAlign: "left" }}
            autoComplete="off" value={form.username} onChange={set("username")} />
          <p className="field-hint">{t("memberUsernameHint", { code: hotel.slug })}</p>
          {address && (
            <p className="field-hint mono" dir="ltr" style={{ textAlign: "start" }}>{address}</p>
          )}
        </div>
      ) : (
        <div className="field">
          <label htmlFor={`me-${hotel.id}`}>{t("memberEmail")}</label>
          <input id={`me-${hotel.id}`} type="email" dir="ltr" style={{ textAlign: "left" }}
            value={form.email} onChange={set("email")} />
          <p className="field-hint">{t("memberEmailHint")}</p>
        </div>
      )}

      {existing ? (
        <div className="banner warn" style={{ margin: 0 }}>{t("memberExists", { name: existing })}</div>
      ) : (
        <div className="row">
          <div className="field grow">
            <label htmlFor={`mw-${hotel.id}`}>{t("memberPassword")}</label>
            <input id={`mw-${hotel.id}`} type="password" dir="ltr" autoComplete="new-password"
              value={form.password} placeholder={t("passwordPlaceholder")} onChange={set("password")} />
          </div>
          <div className="field grow">
            <label htmlFor={`mw2-${hotel.id}`}>{t("ownerPasswordAgain")}</label>
            <input id={`mw2-${hotel.id}`} type="password" dir="ltr" autoComplete="new-password"
              value={form.again} onChange={set("again")} />
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>{t(`problem_${problems[0]}`)}</div>
      )}

      <div className="row">
        <button className="btn primary grow" onClick={submit} disabled={busy || problems.length > 0}>
          {busy ? t("creating") : existing ? t("memberLinkConfirm") : t("addMemberConfirm")}
        </button>
        <button className="btn" onClick={onCancel}>{t("cancel")}</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- a new hotel */

/** What a new hotel opens on unless the operator says otherwise. */
const OPENING_LICENSE = {
  licMode: "trial", trialDays: String(DEFAULT_TRIAL_DAYS), months: "12",
  amount: "", method: "cash",
};

/** Today on the hotel's own calendar, which is the one its licence counts in. */
function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function NewHotel({ taken, onCreate, onDone, onError }) {
  const t = useTranslations("Platform");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", name_en: "", code: "", codeTouched: false,
    timezone: "Africa/Cairo",
    ownerName: "", ownerEmail: "", password: "", again: "",
    withDemo: true,
    ...OPENING_LICENSE,
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

  const licenceChoice = {
    mode: form.licMode, trialDays: form.trialDays, months: form.months,
    amount: form.amount, method: form.method,
  };
  const licenceIssue = openingProblem(licenceChoice);
  const problems = [
    ...newHotelProblems(form, taken),
    ...(licenceIssue ? [`lic:${licenceIssue}`] : []),
  ];
  const problemText = (problem) => (problem.startsWith("lic:")
    ? t(`licProblem_${problem.slice(4)}`)
    : t(`problem_${problem}`));

  async function create() {
    if (problems.length) return onError(problemText(problems[0]));
    setBusy(true);
    const out = await onCreate({
      action: "create_property",
      name: form.name, name_en: form.name_en, slug: form.code, timezone: form.timezone,
      owner_name: form.ownerName, owner_email: form.ownerEmail, owner_password: form.password,
    });
    if (out.error) { setBusy(false); return onError(out.error); }

    // The hotel exists either way; only its furniture is optional, so a
    // failure here is reported without taking the hotel back out.
    if (form.withDemo && out.property_id) {
      const { error } = await supabase.rpc("seed_demo_property", { p_property: out.property_id });
      if (error) onError(error.message);
    }

    // Likewise the licence: if it fails the hotel is on the implicit
    // fourteen-day trial, which is safe, and can be set from its card.
    if (out.property_id) {
      for (const step of openingCalls(licenceChoice, todayIn(form.timezone))) {
        const { error } = await supabase.rpc(step.fn, { p_property: out.property_id, ...step.args });
        if (error) { onError(error.message); break; }
      }
    }
    setBusy(false);
    setForm({
      name: "", name_en: "", code: "", codeTouched: false, timezone: "Africa/Cairo",
      ownerName: "", ownerEmail: "", password: "", again: "", withDemo: true,
      ...OPENING_LICENSE,
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

      {/* On by default. A hotel that opens with no rooms and no prices
          cannot take a booking or be shown to anybody, and whoever opens it
          has to build the whole setup before seeing the app work at all. */}
      <label className="check-row">
        <input type="checkbox" checked={form.withDemo}
          onChange={(event) => setForm((current) => ({ ...current, withDemo: event.target.checked }))} />
        <span>{t("withDemo")}</span>
      </label>
      <p className="field-hint">{t("withDemoHint")}</p>

      <div className="field">
        <span>{t("licOpening")}</span>
        <div className="tabs" role="tablist">
          {OPENING_CHOICES.map((mode) => (
            <button key={mode} type="button" className="tab" role="tab"
              aria-selected={form.licMode === mode}
              onClick={() => setForm((current) => ({ ...current, licMode: mode }))}>
              {t(`licOpening_${mode}`)}
            </button>
          ))}
        </div>
        <p className="field-hint">{t(`licOpeningHint_${form.licMode}`)}</p>
      </div>

      {form.licMode === "trial" && (
        <div className="field">
          <label htmlFor="lic-trial">{t("licTrialDays")}</label>
          <input id="lic-trial" type="number" min="1" max="90" inputMode="numeric"
            value={form.trialDays} onChange={set("trialDays")} />
        </div>
      )}

      {form.licMode === "paid" && (
        <div className="row">
          <div className="field grow">
            <label htmlFor="lic-months">{t("licCustomMonths")}</label>
            <input id="lic-months" type="number" min="1" max="60" inputMode="numeric"
              value={form.months} onChange={set("months")} />
          </div>
          <div className="field grow">
            <label htmlFor="lic-amount">{t("licAmount")}</label>
            <input id="lic-amount" type="number" min="0" inputMode="decimal" placeholder="0"
              value={form.amount} onChange={set("amount")} />
          </div>
          <div className="field grow">
            <label htmlFor="lic-method">{t("licMethod")}</label>
            <select id="lic-method" value={form.method} onChange={set("method")}>
              {PAY_METHODS.map((method) => (
                <option key={method} value={method}>{t(`licMethod_${method}`)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>{problemText(problems[0])}</div>
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
