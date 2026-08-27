"use client";
import { useEffect, useState, useCallback } from "react";
import { currencyWord } from "../lib/hotel-settings";
import Link from "next/link";
import Shell, { useProperty, Toast, useToast } from "../components/Shell";
import SetupChecklist from "../components/SetupChecklist";
import ProvisionalBookings from "../components/ProvisionalBookings";
import StuckActions from "../components/StuckActions";
import { supabase, egp, today, addDays, dayLabel } from "../lib/supabase";
import { formatNumber, joinList } from "../lib/format";
import { earlyDepartureAmounts, isLeavingEarly } from "../lib/checkout";
import { loadCached, queueAdd, useOffline } from "../lib/offline";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import {
  Ban, BedDouble, Brush, CalendarDays, DoorOpen, LogIn,
  LogOut, RefreshCw, UserRound,
} from "lucide-react";

export default function Page() {
  return (
    <Shell>
      <Board />
    </Shell>
  );
}

function Board() {
  const { property, role } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Board");
  const [rows, setRows] = useState([]);
  const [attention, setAttention] = useState([]);
  const [arrivals, setArrivals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null);
  const [stale, setStale] = useState(null);
  const [toast, showToast] = useToast();
  const { online } = useOffline();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);

    // Falls back to the last saved copy when there's no connection.
    const [board, att, arr] = await Promise.all([
      loadCached(`board:${property.id}`, () =>
        supabase.from("today_board").select("*").eq("property_id", property.id)),
      loadCached(`attention:${property.id}`, () =>
        supabase.from("attention_queue").select("*").eq("property_id", property.id)),
      loadCached(`arrivals:${property.id}:${today()}`, () =>
        supabase.from("bookings")
          .select("id, reference, source, check_in, check_out, adults, total_amount, notes, guests(full_name, phone), room_allocations(rooms(number))")
          .eq("property_id", property.id).eq("status", "confirmed").eq("check_in", today())),
    ]);

    setRows((board.data || []).sort((a, b) =>
      String(a.room_number).localeCompare(String(b.room_number), "en", { numeric: true })
    ));
    setAttention(att.data || []);
    setArrivals(arr.data || []);
    setStale(board.stale ? board.at : null);
    setLoading(false);
  }, [property]);

  useEffect(() => { load(); }, [load]);

  const occupied = rows.filter((r) => r.booking_id).length;
  const dirty = rows.filter((r) => r.housekeeping_status === "dirty").length;
  const departing = rows.filter((r) => r.departing_today).length;

  return (
    <>
      <Toast {...(toast || {})} />

      <SetupChecklist property={property} role={role} />

      <StuckActions />
      <ProvisionalBookings />

      {attention.length > 0 && (
        <div className="banner bad">
          <strong>{t("attention", { count: attention.length })}</strong>
          <div className="stack" style={{ marginTop: 8 }}>
            {attention.map((a) => (
              <div key={a.booking_id} className="spread" style={{ fontSize: 13 }}>
                <span>
                  <span className="code">{a.reference}</span> {a.guest_name} — {a.reason}
                </span>
                {a.guest_phone && (
                  <a className="btn sm" href={`tel:${a.guest_phone}`}>{t("call")}</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {stale && (
        <div className="stale">
          {t("staleAt", { at: new Date(stale).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
            hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) })}
          {" — "}{t("staleNote")}
        </div>
      )}

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
        </div>
        {/* On a phone the word goes and the button stays. It used to be the
            other way round, which left reception with no way to refresh on
            the one device they actually carry. */}
        <button className="btn dashboard-refresh" onClick={load} disabled={loading}
          aria-label={t("refresh")}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          <span>{t("refresh")}</span>
        </button>
      </div>

      <div className="dashboard-stats">
        <Stat icon={BedDouble} label={t("occupied")}
          value={formatNumber(occupied, locale)} suffix={t("ofRooms", { count: rows.length })} tone="sea" />
        <Stat icon={LogOut} label={t("departures")}
          value={formatNumber(departing, locale)} tone="sand" />
        <Stat icon={Brush} label={t("needsCleaning")}
          value={formatNumber(dirty, locale)} tone="danger" />
      </div>

      <section className="section dashboard-section">
        <div className="dashboard-section-title">
          <CalendarDays size={22} />
          <h2>{t("arrivals")}</h2>
          <span className="pill">{formatNumber(arrivals.length, locale)}</span>
        </div>
        {arrivals.length > 0 ? (
          <div className="arrivals-table">
            <div className="arrival-row arrival-head" aria-hidden="true">
              <span>{t("colBooking")}</span><span>{t("colGuest")}</span>
              <span>{t("colStay")}</span><span>{t("colRoom")}</span>
              <span>{t("colSource")}</span><span>{t("colNotes")}</span><span />
            </div>
            {arrivals.map((b) => (
              <div key={b.id} className="arrival-row">
                <span className="code arrival-reference">{b.reference}</span>
                <span className="arrival-guest"><UserRound size={17} />{b.guests?.full_name}</span>
                <span className="arrival-stay">{dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}<small>{t("paxCount", { count: b.adults || 0 })}</small></span>
                <span className="mono arrival-room">{arrivalRooms(b, locale)}</span>
                <span>{t(`source_${b.source || "other"}`)}</span>
                <span className="arrival-notes" data-empty={!b.notes}>{b.notes || "—"}</span>
                <button
                  className="btn primary sm arrival-action"
                  onClick={async () => {
                    if (!navigator.onLine) {
                      queueAdd({ kind: "rpc", fn: "check_in_booking", property_id: property.id, args: { p_booking: b.id } });
                      showToast(t("queued"));
                      return;
                    }
                    const { error } = await supabase.rpc("check_in_booking", { p_booking: b.id });
                    if (error) showToast(error.message, true);
                    else { showToast(t("checkedIn")); load(); }
                  }}
                >
                  <LogIn size={16} />{t("checkIn")}
                </button>
              </div>
            ))}
          </div>
        ) : <div className="empty compact-empty">{t("noArrivals")}</div>}
      </section>

      <section className="section dashboard-section">
        <div className="dashboard-section-title">
          <BedDouble size={22} />
          <h2>{t("roomStatus")}</h2>
        </div>
        <p className="section-note">{t("roomStatusNote")}</p>

        {loading ? (
          <div className="empty">{t("loading")}</div>
        ) : (
          <>
            <div className="room-status-grid">
              {rows.map((r) => (
                <RoomStatusCard key={r.room_id} room={r} locale={locale} t={t} onClick={() => setSheet(r)} />
              ))}
            </div>
            <div className="room-legend" aria-label={t("legend")}>
              {["free", "occupied", "dirty", "ooo"].map((state) => <span key={state}><i data-state={state} />{t(`state_${state}`)}</span>)}
            </div>
          </>
        )}
      </section>

      {sheet && (
        <RoomSheet
          row={sheet}
          locale={locale}
          role={role}
          onClose={() => setSheet(null)}
          onDone={(m) => { showToast(m); setSheet(null); load(); }}
          onError={(m) => showToast(m, true)}
        />
      )}
    </>
  );
}

function Stat({ icon: Icon, label, value, suffix, tone }) {
  return (
    <div className="dashboard-stat card" data-tone={tone}>
      <div className="stat-icon"><Icon size={25} /></div>
      <div><span>{label}</span><strong className="mono">{value}{suffix && <small>{suffix}</small>}</strong></div>
    </div>
  );
}

function stateOf(r) {
  if (r.housekeeping_status === "out_of_order") return "ooo";
  if (r.booking_id) return "occupied";
  if (r.housekeeping_status === "dirty") return "dirty";
  return "free";
}

function RoomStatusCard({ room, locale, t, onClick }) {
  const state = stateOf(room);
  const Icon = state === "dirty" ? Brush : state === "ooo" ? Ban : BedDouble;
  return <button className="room-status-card" data-state={state} onClick={onClick}>
    <div className="room-status-icon"><Icon size={27} /></div>
    <div className="room-status-copy">
      <div className="room-status-top"><strong className="mono">{room.room_number}</strong><span>{t(`state_${state}`)}</span></div>
      {room.booking_id ? (
        <>
          <div className="room-guest">{room.guest_name}</div>
          <div className="room-departure">
            <DoorOpen size={14} />
            {room.departing_today ? t("departsToday") : t("departsOn", { date: dayLabel(room.ends_on, locale) })}
          </div>
        </>
      ) : (
        <div className="room-empty-note">{state === "free" ? t("readyNext") : t("tapForDetails")}</div>
      )}
    </div>
  </button>;
}

function arrivalRooms(booking, locale) {
  const rooms = (booking.room_allocations || []).map((item) => item.rooms?.number).filter(Boolean);
  return rooms.length ? joinList(rooms, locale) : "—";
}

function RoomSheet({ row, role, locale, onClose, onDone, onError }) {
  const t = useTranslations("Board");
  const { online } = useOffline();
  const [busy, setBusy] = useState(false);
  const [extendTo, setExtendTo] = useState(row.ends_on ? addDays(row.ends_on, 1) : "");
  const [check, setCheck] = useState(null);
  const canManage = ["owner", "manager", "reception"].includes(role);

  async function run(fn, msg, queued) {
    // The booking already exists, so replaying these later is safe.
    if (!navigator.onLine && queued) {
      queueAdd(queued);
      onDone(t("queued"));
      return;
    }
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) onError(error.message);
      else onDone(msg);
    } finally {
      setBusy(false);
    }
  }

  async function testExtension() {
    const { data, error } = await supabase.rpc("check_extension", {
      p_booking: row.booking_id,
      p_new_check_out: extendTo,
    });
    if (error) return onError(error.message);
    setCheck(data || []);
  }

  const blocked = (check || []).find((c) => !c.can_extend);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 className="mono" style={{ fontSize: 26 }}>{row.room_number}</h2>
          <button className="btn sm" onClick={onClose}>{t("close")}</button>
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          <span className={`pill ${row.booking_id ? "dark" : "ok"}`}>
            {t(`state_${stateOf(row)}`)}
          </span>
          <span className="pill">{locale === "en" ? (row.room_type_en || row.room_type) : row.room_type}</span>
        </div>

        {row.booking_id ? (
          <>
            <div className="card" style={{ background: "var(--paper)", marginBottom: 14 }}>
              <div style={{ fontWeight: 600 }}>{row.guest_name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                <span className="code">{row.reference}</span>{" "}
                {dayLabel(row.starts_on, locale)} ← {dayLabel(row.ends_on, locale)}
              </div>
              {row.guest_phone && (
                <div className="row" style={{ marginTop: 10 }}>
                  <a className="btn sm" href={`tel:${row.guest_phone}`}>{t("call")}</a>
                  <a
                    className="btn sm"
                    target="_blank" rel="noreferrer"
                    href={`https://wa.me/${row.guest_phone.replace(/[^\d]/g, "")}`}
                  >
                    {t("whatsapp")}
                  </a>
                </div>
              )}
            </div>

            {canManage && (
              <>
                <div className="section">
                  <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("extendTitle")}</h2>
                  <div className="row">
                    <input
                      type="date" className="mono grow" dir="ltr" style={{ textAlign: "left" }} value={extendTo}
                      min={addDays(row.ends_on, 1)}
                      onChange={(e) => { setExtendTo(e.target.value); setCheck(null); }}
                    />
                    <button className="btn" onClick={testExtension} disabled={!navigator.onLine}>
                      {t("checkAvailability")}
                    </button>
                  </div>

                  {!online && (
                    <div className="banner warn" style={{ marginTop: 10 }}>
                      {t("extendOffline")}
                    </div>
                  )}

                  {check && (
                    blocked ? (
                      <div className="banner bad" style={{ marginTop: 10 }}>
                        {t("blockedFrom", {
                          room: blocked.room_number,
                          date: dayLabel(blocked.blocked_from, locale),
                          by: blocked.blocked_by,
                        })}
                        <div style={{ marginTop: 6, fontSize: 12 }}>{t("blockedHint")}</div>
                      </div>
                    ) : (
                      <div className="banner ok" style={{ marginTop: 10 }}>
                        {t("freeUntil")}
                        <button
                          className="btn primary wide" style={{ marginTop: 8 }}
                          disabled={busy}
                          onClick={() => run(
                            () => supabase.rpc("extend_stay", {
                              p_booking: row.booking_id, p_new_check_out: extendTo,
                            }),
                            t("extended")
                          )}
                        >
                          {t("confirmExtend")}
                        </button>
                      </div>
                    )
                  )}
                </div>

                <div className="stack">
                  {online && row.allocation_id && (
                    <MoveGuest row={row} onDone={onDone} onError={onError} />
                  )}
                  <CheckOut row={row} busy={busy} locale={locale} run={run} />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="stack">
            <Link className="btn primary wide" href="/new-booking">
              {t("bookThisRoom")}
            </Link>
            {canManage && stateOf(row) !== "ooo" && (
              <BlockRoom row={row} onDone={onDone} onError={onError} />
            )}
            {stateOf(row) === "ooo" && canManage && (
              <button
                className="btn wide" disabled={busy}
                onClick={() => run(
                  () => supabase.rpc("unblock_room", { p_room: row.room_id }),
                  t("returnedToService")
                )}
              >
                {t("backToService")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Checking out, and the one question only the hotel can answer.
 *
 * A guest leaving on the day they booked is just a check-out. A guest
 * leaving early is a decision: bill the nights they slept, or bill the stay
 * they booked. Most small hotels do the first for a direct booking and the
 * second for a held or high-season one, so the app asks instead of choosing.
 *
 * Either way the room-nights stay at what was slept — billing the full stay
 * puts the difference on the bill as a line, because a night nobody slept in
 * would inflate the occupancy and rate figures in every report.
 */
function CheckOut({ row, busy, locale, run }) {
  const t = useTranslations("Checkout");
  const b = useTranslations("Board");
  const [asking, setAsking] = useState(false);
  const [nights, setNights] = useState(null);
  const leavingEarly = isLeavingEarly(row.ends_on, today());

  // Fetched only when the question is actually asked, and only so the two
  // amounts can be shown: reception should be choosing between two numbers
  // with the guest in front of them, not between two sentences.
  useEffect(() => {
    if (!asking || !row.booking_id) return;
    supabase.from("allocation_nights")
      .select("allocation_id, night, amount")
      .eq("booking_id", row.booking_id)
      .then(({ data }) => setNights(data || []));
  }, [asking, row.booking_id]);

  const amounts = nights ? earlyDepartureAmounts(nights, today()) : null;

  const go = (chargeUnstayed) => run(
    () => supabase.rpc("check_out_booking", {
      p_booking: row.booking_id, p_charge_unstayed: chargeUnstayed,
    }),
    b("checkedOut"),
    { kind: "rpc", fn: "check_out_booking", property_id: row.property_id,
      args: { p_booking: row.booking_id, p_charge_unstayed: chargeUnstayed } }
  );

  if (!leavingEarly) {
    return (
      <button className="btn primary wide" disabled={busy} onClick={() => go(false)}>
        {busy ? b("checkingOut") : b("checkOut")}
      </button>
    );
  }

  if (!asking) {
    return (
      <button className="btn primary wide" disabled={busy} onClick={() => setAsking(true)}>
        {b("checkOut")}
      </button>
    );
  }

  return (
    <div className="card stack" style={{ background: "var(--paper)" }}>
      <div>
        <h2 style={{ fontSize: 14, marginBottom: 4 }}>{t("earlyTitle")}</h2>
        <p className="section-note" style={{ margin: 0 }}>
          {t("earlyBody", { date: dayLabel(row.ends_on, locale) })}
        </p>
      </div>
      {/* Neither is preselected. Both carry their price, so the choice is
          made on the amount rather than on which button looks default. */}
      <button className="btn wide choice" disabled={busy} onClick={() => go(false)}>
        <span>{t("billNights")}</span>
        <strong className="mono">
          {amounts ? `${egp(amounts.stayed, locale)} ${currencyWord(locale)}` : "…"}
        </strong>
      </button>
      <button className="btn wide choice" disabled={busy} onClick={() => go(true)}>
        <span>{t("billWholeStay")}</span>
        <strong className="mono">
          {amounts ? `${egp(amounts.booked, locale)} ${currencyWord(locale)}` : "…"}
        </strong>
      </button>
      <button className="btn wide" disabled={busy} onClick={() => setAsking(false)}>
        {b("back")}
      </button>
      <p className="field-hint" style={{ margin: 0 }}>{t("earlyNote")}</p>
    </div>
  );
}

// A move acts on one allocation, not the whole booking: a group in three
// rooms might only need one of them changed.
function MoveGuest({ row, onDone, onError }) {
  const t = useTranslations("Board");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(null);
  const [from, setFrom] = useState(today());
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function look() {
    setBusy(true);
    const { data, error } = await supabase.rpc("suggest_alternative_rooms", {
      p_allocation: row.allocation_id,
      p_from: from,
      p_to: row.ends_on,
    });
    setBusy(false);
    if (error) return onError(error.message);
    setOptions(data || []);
  }

  async function move(roomId) {
    setBusy(true);
    const { error } = await supabase.rpc("move_room", {
      p_allocation: row.allocation_id,
      p_new_room: roomId,
      p_from: from,
      p_reason: reason || null,
    });
    setBusy(false);
    if (error) return onError(error.message);
    onDone(t("moved"));
  }

  if (!open) {
    return (
      <button className="btn wide" onClick={() => { setOpen(true); look(); }}>
        {t("moveOpen")}
      </button>
    );
  }

  return (
    <div className="card stack" style={{ background: "var(--paper)" }}>
      <h2 style={{ fontSize: 14 }}>{t("moveTitle")}</h2>

      <div className="field">
        <label>{t("moveFrom")}</label>
        <input
          type="date" className="mono" dir="ltr" style={{ textAlign: "left" }} value={from}
          min={row.starts_on} max={addDays(row.ends_on, -1)}
          onChange={(e) => { setFrom(e.target.value); setOptions(null); }}
        />
      </div>
      <p className="section-note" style={{ margin: 0 }}>
        {t("moveHint")}
      </p>

      {!options ? (
        <button className="btn" onClick={look} disabled={busy}>
          {busy ? t("searching") : t("showAvailable")}
        </button>
      ) : options.length === 0 ? (
        <div className="banner bad" style={{ margin: 0 }}>
          {t("noneFit", { count: row.occupancy || 0 })}
        </div>
      ) : (
        <>
          <div className="field">
            <label>{t("reasonOptional")}</label>
            <input value={reason} placeholder={t("reasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="stack">
            {options.map((o) => (
              <div key={o.room_id} className="card spread">
                <div className="grow">
                  <span className="mono" style={{ fontSize: 19, fontWeight: 600 }}>
                    {o.room_number}
                  </span>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {o.type_name}
                    {!o.same_type && t("differentType")}
                  </div>
                </div>
                <button className="btn primary sm" disabled={busy}
                  onClick={() => move(o.room_id)}>
                  {t("moveHere")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn wide" onClick={() => setOpen(false)}>{t("cancel")}</button>
    </div>
  );
}

function BlockRoom({ row, onDone, onError }) {
  const t = useTranslations("Board");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return <button className="btn wide danger" onClick={() => setOpen(true)}>{t("blockOpen")}</button>;
  }

  return (
    <div className="card" style={{ background: "var(--paper)" }}>
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("blockTitle")}</h2>
      <div className="stack">
        <div className="row">
          <div className="field grow">
            <label>{t("from")}</label>
            <input type="date" className="mono" dir="ltr" style={{ textAlign: "left" }} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field grow">
            <label>{t("to")}</label>
            <input type="date" className="mono" dir="ltr" style={{ textAlign: "left" }} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>{t("reason")}</label>
          <input value={reason} placeholder={t("reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button
          className="btn danger wide" disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { data, error } = await supabase.rpc("block_room", {
              p_room: row.room_id, p_from: from, p_to: to,
              p_reason: reason || t("maintenance"),
            });
            setBusy(false);
            if (error) return onError(error.message);
            onDone(
              data?.length
                ? t("blockedWithMoves", { count: data.length })
                : t("blocked")
            );
          }}
        >
          {t("confirmBlock")}
        </button>
        <button className="btn wide" onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
    </div>
  );
}
