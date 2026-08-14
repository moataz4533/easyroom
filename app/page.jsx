"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Shell, { useProperty, Toast, useToast } from "../components/Shell";
import SetupChecklist from "../components/SetupChecklist";
import { supabase, today, addDays, dayLabel } from "../lib/supabase";
import { loadCached, queueAdd, useOffline } from "../lib/offline";
import { useLocale } from "next-intl";
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
  const isEn = locale === "en";

  return (
    <>
      <Toast {...(toast || {})} />

      <SetupChecklist property={property} role={role} />

      {attention.length > 0 && (
        <div className="banner bad">
          <strong>{attention.length} حجز يحتاج تدخلاً.</strong>
          <div className="stack" style={{ marginTop: 8 }}>
            {attention.map((a) => (
              <div key={a.booking_id} className="spread" style={{ fontSize: 13 }}>
                <span>
                  <span className="code">{a.reference}</span> {a.guest_name} — {a.reason}
                </span>
                {a.guest_phone && (
                  <a className="btn sm" href={`tel:${a.guest_phone}`}>اتصل</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {stale && (
        <div className="stale">
          آخر تحديث: {new Date(stale).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
            hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
          {" — "}هذه بيانات محفوظة، وليست لحظية.
        </div>
      )}

      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">{isEn ? "DAILY OPERATIONS" : "تشغيل الفندق"}</span>
          <h1>{isEn ? "Today overview" : "نظرة اليوم"}</h1>
        </div>
        <button className="btn dashboard-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={17} className={loading ? "spin" : ""} />
          {isEn ? "Refresh" : "تحديث"}
        </button>
      </div>

      <div className="dashboard-stats">
        <Stat icon={BedDouble} label={isEn ? "Occupied rooms" : "الغرف المشغولة"}
          value={occupied} suffix={`${isEn ? "of" : "من"} ${rows.length}`} tone="sea" />
        <Stat icon={LogOut} label={isEn ? "Departures today" : "مغادرة اليوم"}
          value={departing} tone="sand" />
        <Stat icon={Brush} label={isEn ? "Needs cleaning" : "تحتاج تنظيف"}
          value={dirty} tone="danger" />
      </div>

      <section className="section dashboard-section">
        <div className="dashboard-section-title">
          <CalendarDays size={22} />
          <h2>{isEn ? "Arrivals today" : "وصول اليوم"}</h2>
          <span className="pill">{arrivals.length}</span>
        </div>
        {arrivals.length > 0 ? (
          <div className="arrivals-table">
            <div className="arrival-row arrival-head" aria-hidden="true">
              <span>{isEn ? "Booking" : "رقم الحجز"}</span><span>{isEn ? "Guest" : "النزيل"}</span>
              <span>{isEn ? "Stay" : "الإقامة"}</span><span>{isEn ? "Room" : "الغرفة"}</span>
              <span>{isEn ? "Source" : "نوع الحجز"}</span><span>{isEn ? "Notes" : "ملاحظات"}</span><span />
            </div>
            {arrivals.map((b) => (
              <div key={b.id} className="arrival-row">
                <span className="code arrival-reference">{b.reference}</span>
                <span className="arrival-guest"><UserRound size={17} />{b.guests?.full_name}</span>
                <span className="arrival-stay">{dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}<small>{b.adults} {isEn ? "guests" : "أفراد"}</small></span>
                <span className="mono arrival-room">{arrivalRooms(b)}</span>
                <span>{sourceLabel(b.source, locale)}</span>
                <span className="arrival-notes">{b.notes || "—"}</span>
                <button
                  className="btn primary sm arrival-action"
                  onClick={async () => {
                    if (!navigator.onLine) {
                      queueAdd({ kind: "rpc", fn: "check_in_booking", args: { p_booking: b.id } });
                      showToast("تم التسجيل، وسيُرسل فور عودة الاتصال");
                      return;
                    }
                    const { error } = await supabase.rpc("check_in_booking", { p_booking: b.id });
                    if (error) showToast(error.message, true);
                    else { showToast("تم التسكين"); load(); }
                  }}
                >
                  <LogIn size={16} />{isEn ? "Check in" : "تسجيل الوصول"}
                </button>
              </div>
            ))}
          </div>
        ) : <div className="empty compact-empty">{isEn ? "No arrivals scheduled for today." : "لا يوجد وصول مسجّل اليوم."}</div>}
      </section>

      <section className="section dashboard-section">
        <div className="dashboard-section-title">
          <BedDouble size={22} />
          <h2>{isEn ? "Room status" : "حالة الغرف"}</h2>
        </div>
        <p className="section-note">{isEn ? "Select a room to view details and available actions." : "اضغط على أي غرفة لعرض التفاصيل والإجراءات."}</p>

        {loading ? (
          <div className="empty">جارٍ التحميل…</div>
        ) : (
          <>
            <div className="room-status-grid">
              {rows.map((r) => (
                <RoomStatusCard key={r.room_id} room={r} locale={locale} onClick={() => setSheet(r)} />
              ))}
            </div>
            <div className="room-legend" aria-label={isEn ? "Room status legend" : "دليل حالات الغرف"}>
              {["free", "occupied", "dirty", "ooo"].map((state) => <span key={state}><i data-state={state} />{stateLabel(state, locale)}</span>)}
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

function stateLabel(s, locale = "ar") {
  const labels = locale === "en"
    ? { free: "Available", occupied: "Occupied", dirty: "Needs cleaning", ooo: "Out of service" }
    : { free: "متاحة", occupied: "مشغولة", dirty: "تحتاج تنظيف", ooo: "خارج الخدمة" };
  return labels[s];
}

function RoomStatusCard({ room, locale, onClick }) {
  const state = stateOf(room);
  const Icon = state === "dirty" ? Brush : state === "ooo" ? Ban : BedDouble;
  return <button className="room-status-card" data-state={state} onClick={onClick}>
    <div className="room-status-icon"><Icon size={27} /></div>
    <div className="room-status-copy">
      <div className="room-status-top"><strong className="mono">{room.room_number}</strong><span>{stateLabel(state, locale)}</span></div>
      {room.booking_id ? <><div className="room-guest">{room.guest_name}</div><div className="room-departure"><DoorOpen size={14} />{room.departing_today ? (locale === "en" ? "Departs today" : "مغادرة اليوم") : `${locale === "en" ? "Departs" : "المغادرة"} ${dayLabel(room.ends_on, locale)}`}</div></> : <div className="room-empty-note">{locale === "en" ? "Ready for the next guest" : state === "free" ? "جاهزة للنزيل القادم" : "اضغط لعرض التفاصيل"}</div>}
    </div>
  </button>;
}

function arrivalRooms(booking) {
  const rooms = (booking.room_allocations || []).map((item) => item.rooms?.number).filter(Boolean);
  return rooms.length ? rooms.join("، ") : "—";
}

function sourceLabel(source, locale) {
  const labels = locale === "en"
    ? { whatsapp: "WhatsApp", phone: "Phone", walk_in: "Walk-in", website: "Website", ota: "OTA", referral: "Referral", other: "Other" }
    : { whatsapp: "واتساب", phone: "مكالمة", walk_in: "مباشر", website: "الموقع", ota: "مواقع حجز", referral: "توصية", other: "أخرى" };
  return labels[source] || source || "—";
}

function RoomSheet({ row, role, locale, onClose, onDone, onError }) {
  const { online } = useOffline();
  const [busy, setBusy] = useState(false);
  const [extendTo, setExtendTo] = useState(row.ends_on ? addDays(row.ends_on, 1) : "");
  const [check, setCheck] = useState(null);
  const canManage = ["owner", "manager", "reception"].includes(role);

  async function run(fn, msg, queued) {
    // The booking already exists, so replaying these later is safe.
    if (!navigator.onLine && queued) {
      queueAdd(queued);
      onDone("تم التسجيل، وسيُرسل فور عودة الاتصال");
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
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(11,58,70,.5)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "100%", maxWidth: 480, borderRadius: "14px 14px 0 0",
          maxHeight: "88vh", overflowY: "auto", paddingBottom: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 className="mono" style={{ fontSize: 26 }}>{row.room_number}</h2>
          <button className="btn sm" onClick={onClose}>إغلاق</button>
        </div>

        <div className="row" style={{ marginBottom: 14 }}>
          <span className={`pill ${row.booking_id ? "dark" : "ok"}`}>
            {stateLabel(stateOf(row))}
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
                  <a className="btn sm" href={`tel:${row.guest_phone}`}>اتصل</a>
                  <a
                    className="btn sm"
                    target="_blank" rel="noreferrer"
                    href={`https://wa.me/${row.guest_phone.replace(/[^\d]/g, "")}`}
                  >
                    واتساب
                  </a>
                </div>
              )}
            </div>

            {canManage && (
              <>
                <div className="section">
                  <h2 style={{ fontSize: 14, marginBottom: 8 }}>تمديد الإقامة</h2>
                  <div className="row">
                    <input
                      type="date" className="mono grow" value={extendTo}
                      min={addDays(row.ends_on, 1)}
                      onChange={(e) => { setExtendTo(e.target.value); setCheck(null); }}
                    />
                    <button className="btn" onClick={testExtension} disabled={!navigator.onLine}>
                      تحقق
                    </button>
                  </div>

                  {!online && (
                    <div className="banner warn" style={{ marginTop: 10 }}>
                      التمديد يتطلب اتصالاً — يجب التأكد أن الغرفة شاغرة فعلاً قبل تأكيدها للنزيل.
                    </div>
                  )}

                  {check && (
                    blocked ? (
                      <div className="banner bad" style={{ marginTop: 10 }}>
                        الغرفة {blocked.room_number} محجوزة من{" "}
                        {dayLabel(blocked.blocked_from, locale)} ({blocked.blocked_by}).
                        <div style={{ marginTop: 6, fontSize: 12 }}>
                          لتمديد الإقامة انقل النزيل إلى غرفة أخرى — زر «نقل
                          إلى غرفة أخرى» بالأسفل.
                        </div>
                      </div>
                    ) : (
                      <div className="banner ok" style={{ marginTop: 10 }}>
                        الغرفة شاغرة حتى هذا التاريخ.
                        <button
                          className="btn primary wide" style={{ marginTop: 8 }}
                          disabled={busy}
                          onClick={() => run(
                            () => supabase.rpc("extend_stay", {
                              p_booking: row.booking_id, p_new_check_out: extendTo,
                            }),
                            "تم تسجيل التمديد"
                          )}
                        >
                          تأكيد التمديد
                        </button>
                      </div>
                    )
                  )}
                </div>

                <div className="stack">
                  {online && row.allocation_id && (
                    <MoveGuest row={row} onDone={onDone} onError={onError} />
                  )}
                  <button
                    className="btn primary wide" disabled={busy}
                    onClick={() => run(
                      () => supabase.rpc("check_out_booking", { p_booking: row.booking_id }),
                      "تم تسجيل المغادرة، وأُضيفت الغرفة إلى قائمة النظافة",
                      { kind: "rpc", fn: "check_out_booking", args: { p_booking: row.booking_id } }
                    )}
                  >
                    {busy
                      ? (locale === "en" ? "Checking out…" : "جارٍ تسجيل الخروج…")
                      : (locale === "en" ? "Check out" : "تسجيل خروج")}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="stack">
            <Link className="btn primary wide" href="/new-booking">
              احجز الغرفة دي
            </Link>
            {canManage && stateOf(row) !== "ooo" && (
              <BlockRoom row={row} onDone={onDone} onError={onError} />
            )}
            {stateOf(row) === "ooo" && canManage && (
              <button
                className="btn wide" disabled={busy}
                onClick={() => run(
                  () => supabase.rpc("unblock_room", { p_room: row.room_id }),
                  "عادت الغرفة للخدمة"
                )}
              >
                إرجاع الغرفة للخدمة
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A move acts on one allocation, not the whole booking: a group in three
// rooms might only need one of them changed.
function MoveGuest({ row, onDone, onError }) {
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
    onDone("تم نقل النزيل وتعديل الحساب");
  }

  if (!open) {
    return (
      <button className="btn wide" onClick={() => { setOpen(true); look(); }}>
        نقل إلى غرفة أخرى
      </button>
    );
  }

  return (
    <div className="card stack" style={{ background: "var(--paper)" }}>
      <h2 style={{ fontSize: 14 }}>نقل النزيل</h2>

      <div className="field">
        <label>النقل يبدأ من</label>
        <input
          type="date" className="mono" value={from}
          min={row.starts_on} max={addDays(row.ends_on, -1)}
          onChange={(e) => { setFrom(e.target.value); setOptions(null); }}
        />
      </div>
      <p className="section-note" style={{ margin: 0 }}>
        إذا اخترت تاريخاً بعد بداية الإقامة، تبقى الليالي السابقة على الغرفة
        الحالية والباقي على الجديدة.
      </p>

      {!options ? (
        <button className="btn" onClick={look} disabled={busy}>
          {busy ? "جارٍ البحث…" : "عرض الغرف المتاحة"}
        </button>
      ) : options.length === 0 ? (
        <div className="banner bad" style={{ margin: 0 }}>
          لا توجد غرفة شاغرة تتسع لـ {row.occupancy} أفراد في التواريخ دي.
        </div>
      ) : (
        <>
          <div className="field">
            <label>السبب (اختياري)</label>
            <input value={reason} placeholder="تكييف معطل"
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
                    {!o.same_type && " — نوع مختلف، وقد يتغير السعر"}
                  </div>
                </div>
                <button className="btn primary sm" disabled={busy}
                  onClick={() => move(o.room_id)}>
                  انقل هنا
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

function BlockRoom({ row, onDone, onError }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return <button className="btn wide danger" onClick={() => setOpen(true)}>تعطيل الغرفة</button>;
  }

  return (
    <div className="card" style={{ background: "var(--paper)" }}>
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>تعطيل الغرفة</h2>
      <div className="stack">
        <div className="row">
          <div className="field grow">
            <label>من</label>
            <input type="date" className="mono" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field grow">
            <label>لحد</label>
            <input type="date" className="mono" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>السبب</label>
          <input value={reason} placeholder="تكييف معطل" onChange={(e) => setReason(e.target.value)} />
        </div>
        <button
          className="btn danger wide" disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { data, error } = await supabase.rpc("block_room", {
              p_room: row.room_id, p_from: from, p_to: to,
              p_reason: reason || "صيانة",
            });
            setBusy(false);
            if (error) return onError(error.message);
            onDone(
              data?.length
                ? `تم تعطيل الغرفة. ${data.length} حجز يحتاج نقلاً — راجع التنبيه بالأعلى.`
                : "تم تعطيل الغرفة"
            );
          }}
        >
          تأكيد التعطيل
        </button>
        <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </div>
  );
}
