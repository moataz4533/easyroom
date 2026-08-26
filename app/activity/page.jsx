"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ListChecks, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import Shell, { Toast, useProperty, useToast } from "../../components/Shell";
import { supabase } from "../../lib/supabase";
import { joinList } from "../../lib/format";
import { isNamedReason } from "../../lib/cancel-reasons";

export default function Page() { return <Shell><ActivityLog /></Shell>; }

/** Every action the log knows how to name; anything else prints as it came. */
const KNOWN_ACTIONS = new Set([
  "created", "checked_in", "checked_out", "housekeeping_status_changed",
  "received", "refunded", "extended", "shortened", "room_moved", "cancelled",
  "no_show", "room_blocked", "room_unblocked", "pin_changed", "updated",
  "restored", "guests_cleaned", "data_reset", "dates_changed",
]);

const KNOWN_STATUSES = new Set(["clean", "dirty", "inspected", "out_of_order"]);

const TYPES = ["all", "booking", "housekeeping", "money", "admin"];

function ActivityLog() {
  const { property, role } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Activity");
  const common = useTranslations("Common");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("list_activity_timeline", { p_property: property.id, p_limit: 300 });
    if (error) showToast(error.message, true); else setRows(data || []);
    setLoading(false);
  }, [property]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const label = useCallback(
    (action) => (KNOWN_ACTIONS.has(action) ? t(`action_${action}`) : action.replaceAll("_", " ")),
    [t]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      if (type !== "all" && groupOf(row.action) !== type) return false;
      if (!needle) return true;
      return [row.actor_name, row.reference, row.guest_name, ...(row.room_numbers || []), label(row.action)]
        .filter(Boolean).join(" ").toLocaleLowerCase(locale).includes(needle);
    });
  }, [rows, query, type, locale, label]);

  if (!["owner", "manager"].includes(role)) {
    return (
      <div className="card access-card">
        <div className="empty-icon"><ListChecks size={23} /></div>
        <h2>{t("forbidden")}</h2>
        <p>{t("forbiddenBody")}</p>
      </div>
    );
  }

  return <>
    <Toast {...(toast || {})} />
    <div className="page-header">
      <div><h1>{t("title")}</h1><p>{t("subtitle")}</p></div>
      <button className="btn" onClick={load} disabled={loading}>
        <RefreshCw size={17} className={loading ? "spin" : ""} />{common("refresh")}
      </button>
    </div>

    <div className="activity-tools card">
      <label className="activity-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">{t("searchLabel")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")} />
      </label>
      <select value={type} onChange={(event) => setType(event.target.value)} aria-label={t("typeLabel")}>
        {TYPES.map((key) => <option key={key} value={key}>{t(`type_${key}`)}</option>)}
      </select>
    </div>

    {loading ? (
      <div className="empty">{t("loading")}</div>
    ) : filtered.length === 0 ? (
      <div className="empty-state">
        <div className="empty-icon"><ListChecks size={23} /></div>
        <p>{t("none")}</p>
      </div>
    ) : (
      <div className="timeline" aria-live="polite">
        {filtered.map((row, index) => (
          <ActivityRow key={row.id} row={row} locale={locale} t={t} label={label}
            showDay={index === 0 || dayKey(filtered[index - 1].created_at) !== dayKey(row.created_at)} />
        ))}
      </div>
    )}
  </>;
}

function ActivityRow({ row, locale, t, label, showDay }) {
  const tag = locale === "en" ? "en-GB" : "ar-EG";
  const date = new Date(row.created_at);

  const details = [
    row.reference && t("booking", { reference: row.reference }),
    row.guest_name,
    row.room_numbers?.length && t("room", { rooms: joinList(row.room_numbers, locale) }),
    row.action === "housekeeping_status_changed" && KNOWN_STATUSES.has(row.payload?.status)
      && t(`status_${row.payload.status}`),
    ["received", "refunded"].includes(row.action) && row.payload?.amount != null
      ? `${Math.abs(Number(row.payload.amount)).toLocaleString(tag)} EGP`
      : null,
    // Written on every cancellation since the beginning and shown on none
    // of them — which is how twenty-one of them came to say `greekclub`
    // without anybody noticing.
    row.action === "cancelled" && row.payload?.reason
      ? (isNamedReason(row.payload.reason)
        ? t(`reason_${row.payload.reason}`)
        : row.payload.reason)
      : null,
  ].filter(Boolean);

  return <>
    {showDay && (
      <div className="timeline-day">
        <CalendarClock size={15} />
        {date.toLocaleDateString(tag, {
          weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo",
        })}
      </div>
    )}
    <article className="timeline-row">
      <div className={`timeline-dot ${groupOf(row.action)}`} aria-hidden="true" />
      <div className="timeline-card card">
        <div className="spread">
          <div className="grow">
            <strong>{label(row.action)}</strong>
            <div className="timeline-details">{details.join(" · ")}</div>
          </div>
          <time className="mono" dateTime={row.created_at}>
            {date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}
          </time>
        </div>
        <div className="timeline-actor">{t("by", { name: row.actor_name || "—" })}</div>
      </div>
    </article>
  </>;
}

function groupOf(action) {
  if (["received", "refunded"].includes(action)) return "money";
  if (action.includes("housekeeping") || action.includes("room_")) return "housekeeping";
  if (["pin_changed", "updated", "restored", "guests_cleaned"].includes(action)) return "admin";
  return "booking";
}

function dayKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}
