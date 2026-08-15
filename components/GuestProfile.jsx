"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { supabase, egp, dayLabel } from "../lib/supabase";
import { countNights, joinList } from "../lib/format";
import {
  averageStayLength, isReturning, isUnreliable, sortStays, summariseStays,
} from "../lib/guest-history";
import { liveRoomNumbers } from "../lib/guest-record";

/**
 * Everything this hotel knows about one guest.
 *
 * Scoped to the property by construction — guests belong to a property, so
 * the history is this hotel's history with them and nobody else's.
 */
export default function GuestProfile({ guest, onError }) {
  const locale = useLocale();
  const t = useTranslations("Guests");
  const [stays, setStays] = useState(null);

  const load = useCallback(async () => {
    if (!guest?.id) return;
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id, reference, status, check_in, check_out, total_amount, paid_amount, source,
        room_allocations(released_at, rooms(number))
      `)
      .eq("guest_id", guest.id)
      .order("check_in", { ascending: false })
      .limit(100);

    if (error) return onError?.(error.message);
    setStays(data || []);
  }, [guest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (stays === null) return <div className="empty compact-empty">{t("loadingHistory")}</div>;
  if (stays.length === 0) return <div className="empty compact-empty">{t("noHistory")}</div>;

  const summary = summariseStays(stays);

  return (
    <section className="section">
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {isReturning(summary) && (
          <span className="pill ok"><RotateCcw size={12} />{t("returning", { count: summary.stays })}</span>
        )}
        {isUnreliable(summary) && (
          <span className="pill bad"><TriangleAlert size={12} />{t("noShowWarning", { count: summary.noShows })}</span>
        )}
        {summary.outstanding > 0 && (
          <span className="pill warn">{t("owes", { amount: egp(summary.outstanding, locale) })}</span>
        )}
      </div>

      <div className="guest-figures">
        <Figure label={t("visits")} value={egp(summary.stays, locale)} />
        <Figure label={t("totalNights")} value={egp(summary.nights, locale)}
          note={t("averageNights", { count: egp(Math.round(averageStayLength(summary) * 10) / 10, locale) })} />
        <Figure label={t("totalSpent")} value={`${egp(summary.charged, locale)} ${t("currency")}`} />
        <Figure label={t("lastVisit")} value={summary.lastVisit ? dayLabel(summary.lastVisit, locale) : "—"}
          note={summary.firstVisit ? t("since", { date: dayLabel(summary.firstVisit, locale) }) : null} />
      </div>

      <h3 className="guest-history-title"><CalendarCheck size={16} />{t("stayList")}</h3>
      <div className="stack">
        {sortStays(stays).map((stay) => (
          <StayLine key={stay.id} stay={stay} locale={locale} t={t} />
        ))}
      </div>
    </section>
  );
}

function Figure({ label, value, note }) {
  return (
    <div className="guest-figure">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

const STATUS_PILL = {
  confirmed: "dark", checked_in: "ok", checked_out: "",
  cancelled: "bad", no_show: "bad", inquiry: "",
};

function StayLine({ stay, locale, t }) {
  const rooms = liveRoomNumbers(stay);
  const owed = Number(stay.total_amount) - Number(stay.paid_amount);
  const cancelled = stay.status === "cancelled" || stay.status === "no_show";

  return (
    <div className="card spread" style={{ padding: "10px 12px", opacity: cancelled ? .6 : 1 }}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span className="code">{stay.reference}</span>
          <span className={`pill ${STATUS_PILL[stay.status] || ""}`}>{t(`status_${stay.status}`)}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {dayLabel(stay.check_in, locale)} ← {dayLabel(stay.check_out, locale)}
          {" · "}{t("nights", { count: egp(countNights(stay.check_in, stay.check_out), locale) })}
          {rooms.length > 0 && ` · ${joinList(rooms, locale)}`}
        </div>
      </div>
      <div style={{ textAlign: "end" }}>
        <div className="mono" style={{ fontWeight: 600 }}>
          {egp(stay.total_amount, locale)} {t("currency")}
        </div>
        {!cancelled && owed > 0 && (
          <small style={{ color: "var(--danger)" }}>{t("owes", { amount: egp(owed, locale) })}</small>
        )}
      </div>
    </div>
  );
}
