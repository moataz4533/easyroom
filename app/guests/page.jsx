"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import { Download, RefreshCw, X } from "lucide-react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import GuestRecord from "../../components/GuestRecord";
import GuestProfile from "../../components/GuestProfile";
import { supabase, today, addDays, dayLabel } from "../../lib/supabase";
import { joinList, shiftDate } from "../../lib/format";
import {
  buildGuestCsv, csvFilename, describeGuest, implausibleFields, liveRoomNumbers,
  missingFields, needsAttention,
} from "../../lib/guest-record";

export default function Page() {
  return (
    <Shell>
      <Guests />
    </Shell>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function Guests() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Guests");
  const common = useTranslations("Common");
  const [toast, showToast] = useToast();

  const [from, setFrom] = useState(monthStart(today()));
  const [to, setTo] = useState(today());
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [search, setSearch] = useState("");
  const [stays, setStays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState("record");

  const load = useCallback(async () => {
    // A cleared date box reads as "", which is not a date. Without this the
    // range maths throws inside an async call and the screen stays on its
    // loading placeholder with no error anywhere.
    if (!property || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return;
    setLoading(true);

    // Anyone who slept here in the period, which is what the record is
    // about — a booking cancelled before arrival is not a guest.
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id, reference, status, check_in, check_out,
        guests(id, full_name, phone, email, nationality, id_number, date_of_birth, notes),
        room_allocations(released_at, rooms(number))
      `)
      .eq("property_id", property.id)
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .lt("check_in", addDays(to, 1))
      .gt("check_out", from)
      .order("check_in", { ascending: false })
      .limit(500);

    if (error) showToast(error.message, true);
    setStays(data || []);
    setLoading(false);
  }, [property, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const term = search.trim().toLowerCase();
  const shown = useMemo(() => stays.filter((stay) => {
    if (onlyMissing && !needsAttention(stay.guests)) return false;
    if (!term) return true;
    return stay.guests?.full_name?.toLowerCase().includes(term)
      || stay.reference?.toLowerCase().includes(term)
      || stay.guests?.id_number?.toLowerCase().includes(term);
  }), [stays, onlyMissing, term]);

  const incomplete = stays.filter((stay) => needsAttention(stay.guests)).length;

  function exportCsv() {
    const csv = buildGuestCsv(shown, locale);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(from, to);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(t("exported", { count: shown.length }));
  }

  return (
    <>
      <Toast {...(toast || {})} />

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
        </div>
        <button className="btn dashboard-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />{common("refresh")}
        </button>
      </div>
      <p className="section-note">{t("subtitle")}</p>

      <div className="card stack" style={{ marginBottom: 16 }}>
        <div className="row">
          <div className="field grow">
            <label htmlFor="from">{t("from")}</label>
            <input id="from" type="date" className="mono" value={from}
              onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="to">{t("to")}</label>
            <input id="to" type="date" className="mono" value={to} min={from}
              onChange={(event) => setTo(event.target.value)} />
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => { setFrom(today()); setTo(today()); }}>{t("rangeToday")}</button>
          <button className="btn sm" onClick={() => { setFrom(monthStart(today())); setTo(today()); }}>{t("rangeMonth")}</button>
          <button className="btn sm" onClick={() => {
            const previous = shiftDate(monthStart(today()), -1);
            setFrom(monthStart(previous));
            setTo(previous);
          }}>{t("rangeLastMonth")}</button>
        </div>
        <button className="btn primary wide" onClick={exportCsv} disabled={shown.length === 0}>
          <Download size={16} />{t("export", { count: shown.length })}
        </button>
        <p className="section-note" style={{ margin: 0 }}>{t("exportHint")}</p>
      </div>

      {incomplete > 0 && (
        <div className="banner warn">{t("incomplete", { count: incomplete })}</div>
      )}

      <input value={search} placeholder={t("search")} style={{ marginBottom: 12 }}
        onChange={(event) => setSearch(event.target.value)} />

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={!onlyMissing} onClick={() => setOnlyMissing(false)}>
          {t("all")}
        </button>
        <button className="tab" role="tab" aria-selected={onlyMissing} onClick={() => setOnlyMissing(true)}>
          {t("missingOnly")}
        </button>
      </div>

      {loading ? (
        <div className="empty">{common("loading")}</div>
      ) : shown.length === 0 ? (
        <div className="empty">{t("none")}</div>
      ) : (
        <div className="stack">
          {shown.map((stay) => (
            <StayRow key={stay.id} stay={stay} locale={locale} t={t}
              onOpen={() => { setEditing(stay); setTab("record"); }} />
          ))}
        </div>
      )}

      {editing && (
        <div className="dialog-backdrop" onClick={() => setEditing(null)} role="presentation">
          <div className="dialog-panel" onClick={(event) => event.stopPropagation()}>
            <div className="spread" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{editing.guests?.full_name || t("record")}</h2>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  <span className="code">{editing.reference}</span>{" "}
                  {dayLabel(editing.check_in, locale)} ← {dayLabel(editing.check_out, locale)}
                </div>
              </div>
              <button className="btn sm" onClick={() => setEditing(null)} aria-label={common("close")}>
                <X size={16} />
              </button>
            </div>

            {/* The official data is what the law wants; the history is what
                reception wants. Same guest, two different questions. */}
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={tab === "record"}
                onClick={() => setTab("record")}>{t("record")}</button>
              <button className="tab" role="tab" aria-selected={tab === "history"}
                onClick={() => setTab("history")}>{t("history")}</button>
            </div>

            {tab === "record" ? (
              <GuestRecord
                guest={editing.guests}
                onSaved={(message) => { showToast(message); setEditing(null); load(); }}
                onError={(message) => showToast(message, true)}
              />
            ) : (
              <GuestProfile
                guest={editing.guests}
                onError={(message) => showToast(message, true)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StayRow({ stay, locale, t, onOpen }) {
  const guest = stay.guests;
  const missing = missingFields(guest, locale);
  const wrong = implausibleFields(guest, locale);
  const rooms = liveRoomNumbers(stay);

  return (
    <button className="card spread" onClick={onOpen}
      style={{ textAlign: "start", cursor: "pointer", width: "100%",
        fontFamily: "inherit", color: "inherit" }}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{guest?.full_name || "—"}</span>
          {missing.length > 0 && (
            <span className="pill warn">{t("missingCount", { count: missing.length })}</span>
          )}
          {wrong.length > 0 && (
            <span className="pill warn">{t("checkCount", { count: wrong.length })}</span>
          )}
          {missing.length === 0 && wrong.length === 0 && (
            <span className="pill ok">{t("done")}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
          {describeGuest(guest, locale) || t("nothingRecorded")}
        </div>
        {wrong.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 2 }}>
            {joinList(wrong.map((issue) => issue.message), locale)}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          <span className="code">{stay.reference}</span>{" "}
          {dayLabel(stay.check_in, locale)} ← {dayLabel(stay.check_out, locale)}
          {rooms.length > 0 && ` · ${joinList(rooms, locale)}`}
        </div>
      </div>
    </button>
  );
}
