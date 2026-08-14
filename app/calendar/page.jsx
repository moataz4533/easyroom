"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarRange, ChevronLeft, ChevronRight, RefreshCw, Wrench,
} from "lucide-react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, today, addDays, dayLabel } from "../../lib/supabase";
import { localePath, localizedName } from "../../lib/locale";
import { formatNumber } from "../../lib/format";
import { loadCached } from "../../lib/offline";
import {
  DEFAULT_WINDOW, WINDOW_LENGTHS, buildWindow, isWeekend,
  movementsByDay, occupancyByDay, segmentsByRoom, windowRange,
} from "../../lib/calendar";

export default function Page() {
  return (
    <Shell>
      <Calendar />
    </Shell>
  );
}

function Calendar() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Calendar");
  const common = useTranslations("Common");
  const [toast, showToast] = useToast();

  const [length, setLength] = useState(DEFAULT_WINDOW);
  const [start, setStart] = useState(today());
  const [rooms, setRooms] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(null);
  const [sheet, setSheet] = useState(null);

  const days = useMemo(() => buildWindow(start, length), [start, length]);
  const { start: from, end: to } = useMemo(() => windowRange(days), [days]);

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);

    // Overlap, not containment: a stay that began last week and ends next
    // month has to appear even though neither of its dates is on screen.
    const [roomsResult, allocationsResult] = await Promise.all([
      loadCached(`rooms:${property.id}`, () =>
        supabase.from("rooms")
          .select("id, number, room_types(name, name_en)")
          .eq("property_id", property.id).eq("is_active", true)),
      loadCached(`tape:${property.id}:${from}:${to}`, () =>
        supabase.from("room_allocations")
          .select(`
            id, room_id, booking_id, kind, starts_on, ends_on, occupancy, notes,
            bookings(reference, status, source, guests(full_name, phone))
          `)
          .eq("property_id", property.id)
          .is("released_at", null)
          .lt("starts_on", to)
          .gt("ends_on", from)),
    ]);

    setRooms((roomsResult.data || []).sort((a, b) =>
      String(a.number).localeCompare(String(b.number), "en", { numeric: true })
    ));
    setAllocations(allocationsResult.data || []);
    setStale(allocationsResult.stale ? allocationsResult.at : null);
    setLoading(false);

    // Only fires when the network failed and nothing was cached either.
    if (allocationsResult.error) showToast(allocationsResult.error.message, true);
  }, [property, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const segments = useMemo(() => segmentsByRoom(allocations, days), [allocations, days]);
  const occupancy = useMemo(() => occupancyByDay(allocations, days, rooms.length), [allocations, days, rooms.length]);
  const movements = useMemo(() => movementsByDay(allocations, days), [allocations, days]);
  const step = Math.max(1, Math.round(length / 2));

  return (
    <>
      <Toast {...(toast || {})} />

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{t("occupancy")}</span>
          <h1>{t("title")}</h1>
        </div>
        <button className="btn dashboard-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          {common("refresh")}
        </button>
      </div>
      <p className="section-note">{t("subtitle")}</p>

      {stale && (
        <div className="stale">
          {new Date(stale).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
            hour: "2-digit", minute: "2-digit", day: "numeric", month: "short",
          })}{" — "}{t("stale")}
        </div>
      )}

      <div className="tape-toolbar">
        <div className="tape-nav">
          <button className="btn sm" onClick={() => setStart(addDays(start, -step))} aria-label={t("previous")}>
            {locale === "ar" ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button className="btn sm" onClick={() => setStart(today())}>
            <CalendarRange size={15} />{t("today")}
          </button>
          <button className="btn sm" onClick={() => setStart(addDays(start, step))} aria-label={t("next")}>
            {locale === "ar" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <span className="tape-range mono">
            {dayLabel(days[0], locale)} — {dayLabel(days[days.length - 1], locale)}
          </span>
        </div>

        <div className="tape-lengths" role="group" aria-label={t("window")}>
          {WINDOW_LENGTHS.map((option) => (
            <button
              key={option} className="btn sm" data-active={option === length}
              onClick={() => setLength(option)}
            >
              {t("windowDays", { count: option })}
            </button>
          ))}
        </div>
      </div>

      {loading && rooms.length === 0 ? (
        <div className="empty">{t("loading")}</div>
      ) : rooms.length === 0 ? (
        <div className="empty">{t("noRooms")}</div>
      ) : (
        <div className="tape-scroll">
          <div className="tape-grid" style={{ "--tape-days": days.length }}>
            <div className="tape-corner">{t("room")}</div>
            {days.map((day, index) => (
              <div
                key={day} className="tape-head" data-today={day === today()}
                data-weekend={isWeekend(day)} style={{ gridColumn: index + 2 }}
              >
                <strong>{dayLabel(day, locale, { day: "numeric" })}</strong>
                <span>{dayLabel(day, locale, { weekday: "short" })}</span>
                {(movements[index].arrivals > 0 || movements[index].departures > 0) && (
                  // Forced LTR: "+2 −1" flips into nonsense inside Arabic text.
                  <em className="mono" dir="ltr" title={`${movements[index].arrivals} / ${movements[index].departures}`}>
                    {movements[index].arrivals > 0 && `+${movements[index].arrivals}`}
                    {movements[index].departures > 0 && ` −${movements[index].departures}`}
                  </em>
                )}
              </div>
            ))}

            {rooms.map((room, rowIndex) => (
              <RoomRow
                key={room.id} room={room} row={rowIndex + 2} days={days} locale={locale}
                segments={segments.get(room.id) || []} onOpen={setSheet} t={t}
              />
            ))}

            <div className="tape-foot-label" style={{ gridRow: rooms.length + 2 }}>
              {t("occupancyRow")}
            </div>
            {occupancy.map((cell, index) => (
              <div
                key={cell.date} className="tape-foot mono"
                data-full={cell.free === 0}
                style={{ gridRow: rooms.length + 2, gridColumn: index + 2 }}
                title={t("summary", { occupied: cell.occupied, total: rooms.length, date: dayLabel(cell.date, locale) })}
              >
                {formatNumber(cell.occupied, locale)}/{formatNumber(rooms.length, locale)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="room-legend tape-legend" aria-label={t("legend")}>
        <span><i data-state="occupied" />{t("occupied")}</span>
        <span><i data-state="free" />{t("free")}</span>
        <span><i data-state="ooo" />{t("blocked")}</span>
      </div>

      {sheet && (
        <StaySheet
          segment={sheet} locale={locale} t={t} common={common}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

function RoomRow({ room, row, days, segments, locale, onOpen, t }) {
  return (
    <>
      <div className="tape-room" style={{ gridRow: row }}>
        <strong className="mono">{room.number}</strong>
        <span>{localizedName(room.room_types, locale)}</span>
      </div>

      {/* One cell per night, so an empty square is a bookable target. */}
      {days.map((day, index) => (
        <Link
          key={day} className="tape-cell"
          data-today={day === today()} data-weekend={isWeekend(day)}
          style={{ gridRow: row, gridColumn: index + 2 }}
          href={localePath(`/new-booking?check_in=${day}&room=${room.id}`, locale)}
          aria-label={t("bookNight", { room: room.number, date: day })}
        />
      ))}

      {segments.map((segment) => (
        <button
          key={segment.id} className="tape-bar"
          data-kind={segment.kind}
          data-status={segment.bookings?.status || ""}
          data-open-start={segment.continuesBefore}
          data-open-end={segment.continuesAfter}
          style={{ gridRow: row, gridColumn: `${segment.offset + 2} / span ${segment.span}` }}
          onClick={() => onOpen({ ...segment, room })}
        >
          {segment.kind === "booking" ? (
            <span className="tape-bar-name">{segment.bookings?.guests?.full_name || segment.bookings?.reference}</span>
          ) : (
            <span className="tape-bar-name"><Wrench size={13} />{segment.notes || t(segment.kind === "hold" ? "hold" : segment.kind === "staff" ? "staff" : "maintenance")}</span>
          )}
        </button>
      ))}
    </>
  );
}

function StaySheet({ segment, locale, t, common, onClose }) {
  const guest = segment.bookings?.guests;
  const nightCount = Math.max(1, segment.span);
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 className="mono" style={{ fontSize: 24 }}>{segment.room.number}</h2>
          <button className="btn sm" onClick={onClose}>{common("close")}</button>
        </div>

        {segment.kind === "booking" ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{guest?.full_name}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              <span className="code">{segment.bookings?.reference}</span>{" "}
              {dayLabel(segment.starts_on, locale)} ← {dayLabel(segment.ends_on, locale)}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="pill">{t("nights", { count: nightCount })}</span>
              {segment.occupancy ? <span className="pill">{t("guests", { count: segment.occupancy })}</span> : null}
              {segment.continuesBefore && <span className="pill">{t("continuesBefore")}</span>}
              {segment.continuesAfter && <span className="pill">{t("continuesAfter")}</span>}
            </div>

            {guest?.phone && (
              <div className="row" style={{ marginTop: 14 }}>
                <a className="btn sm" href={`tel:${guest.phone}`}>{t("call")}</a>
                <a className="btn sm" target="_blank" rel="noreferrer"
                  href={`https://wa.me/${guest.phone.replace(/[^\d]/g, "")}`}>
                  {t("whatsapp")}
                </a>
              </div>
            )}

            <Link className="btn primary wide" style={{ marginTop: 16 }}
              href={localePath("/bookings", locale)}>
              {t("openBooking")}
            </Link>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600 }}>
              {t(segment.kind === "hold" ? "hold" : segment.kind === "staff" ? "staff" : "maintenance")}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              {dayLabel(segment.starts_on, locale)} ← {dayLabel(segment.ends_on, locale)}
            </div>
            {segment.notes && <p style={{ marginTop: 10 }}>{segment.notes}</p>}
          </>
        )}
      </div>
    </div>
  );
}
