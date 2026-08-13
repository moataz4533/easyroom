"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Shell, { useProperty, Toast, useToast } from "../components/Shell";
import { supabase, egp, today, addDays, dayLabel } from "../lib/supabase";
import { loadCached, queueAdd, useOffline } from "../lib/offline";
import { useLocale } from "next-intl";

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
          .select("id, reference, check_in, check_out, adults, total_amount, guests(full_name, phone)")
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

      {attention.length > 0 && (
        <div className="banner bad">
          <strong>{attention.length} حجز محتاج تدخل.</strong>
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
          {" — "}البيانات دي محفوظة، مش لحظية.
        </div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        <Stat label="مشغولة" value={`${occupied}/${rows.length}`} />
        <Stat label="خروج النهاردة" value={departing} />
        <Stat label="محتاجة نضافة" value={dirty} tone={dirty ? "warn" : null} />
      </div>

      {arrivals.length > 0 && (
        <section className="section">
          <h2>وصول النهاردة</h2>
          <div className="stack">
            {arrivals.map((b) => (
              <div key={b.id} className="card spread">
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{b.guests?.full_name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <span className="code">{b.reference}</span>{" "}
                    {dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)} · {b.adults} أفراد
                  </div>
                </div>
                <button
                  className="btn primary sm"
                  onClick={async () => {
                    if (!navigator.onLine) {
                      queueAdd({ kind: "rpc", fn: "check_in_booking", args: { p_booking: b.id } });
                      showToast("اتسجل، وهيتبعت أول ما النت يرجع");
                      return;
                    }
                    const { error } = await supabase.rpc("check_in_booking", { p_booking: b.id });
                    if (error) showToast(error.message, true);
                    else { showToast("تم التسكين"); load(); }
                  }}
                >
                  تسكين
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="spread" style={{ marginBottom: 4 }}>
          <h2>الغرف</h2>
          <button className="btn sm" onClick={load}>تحديث</button>
        </div>
        <p className="section-note">اضغط على غرفة تشوف تفاصيلها وتعمل إجراء.</p>

        {loading ? (
          <div className="empty">بيحمّل…</div>
        ) : (
          <div className="rack">
            <div className="rail" />
            <div className="rack-grid">
              {rows.map((r) => (
                <button
                  key={r.room_id}
                  className="keycard"
                  data-state={stateOf(r)}
                  onClick={() => setSheet(r)}
                >
                  <div className="num">{r.room_number}</div>
                  <div className="band" />
                  <div className="who">{r.guest_name || stateLabel(stateOf(r))}</div>
                  <div className="sub" style={{ color: "var(--muted)" }}>
                    {r.departing_today ? (locale === "en" ? "Departure today" : "خروج النهاردة")
                      : r.ends_on ? `${locale === "en" ? "Until" : "لحد"} ${dayLabel(r.ends_on, locale)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
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

function Stat({ label, value, tone }) {
  return (
    <div className="card grow" style={{ textAlign: "center", minWidth: 96 }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600,
        color: tone === "warn" ? "var(--sand)" : "var(--ink)" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function stateOf(r) {
  if (r.housekeeping_status === "out_of_order") return "ooo";
  if (r.booking_id) return "occupied";
  if (r.housekeeping_status === "dirty") return "dirty";
  return "free";
}

function stateLabel(s) {
  return { free: "فاضية", occupied: "مشغولة", dirty: "محتاجة نضافة", ooo: "معطلة" }[s];
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
      onDone("اتسجل، وهيتبعت أول ما النت يرجع");
      return;
    }
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) onError(error.message);
    else onDone(msg);
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
                      اتأكد
                    </button>
                  </div>

                  {!online && (
                    <div className="banner warn" style={{ marginTop: 10 }}>
                      التمديد محتاج نت — لازم نتأكد إن الغرفة فاضية فعلاً قبل ما تأكد للنزيل.
                    </div>
                  )}

                  {check && (
                    blocked ? (
                      <div className="banner bad" style={{ marginTop: 10 }}>
                        الغرفة {blocked.room_number} محجوزة من{" "}
                        {dayLabel(blocked.blocked_from, locale)} ({blocked.blocked_by}).
                        <div style={{ marginTop: 6, fontSize: 12 }}>
                          محتاج تنقل النزيل لغرفة تانية عشان تمدد — زرار «نقل
                          لغرفة تانية» تحت.
                        </div>
                      </div>
                    ) : (
                      <div className="banner ok" style={{ marginTop: 10 }}>
                        الغرفة فاضية لحد التاريخ ده.
                        <button
                          className="btn primary wide" style={{ marginTop: 8 }}
                          disabled={busy}
                          onClick={() => run(
                            () => supabase.rpc("extend_stay", {
                              p_booking: row.booking_id, p_new_check_out: extendTo,
                            }),
                            "التمديد اتسجل"
                          )}
                        >
                          أكّد التمديد
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
                      "تم الخروج، والغرفة اتحطت في قايمة النضافة",
                      { kind: "rpc", fn: "check_out_booking", args: { p_booking: row.booking_id } }
                    )}
                  >
                    تسجيل خروج
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
                  "الغرفة رجعت للخدمة"
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
    onDone("النزيل اتنقل، والحساب اتظبط");
  }

  if (!open) {
    return (
      <button className="btn wide" onClick={() => { setOpen(true); look(); }}>
        نقل لغرفة تانية
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
        لو اخترت تاريخ بعد بداية الإقامة، الليالي اللي فاتت هتفضل على الغرفة
        الحالية والباقي على الجديدة.
      </p>

      {!options ? (
        <button className="btn" onClick={look} disabled={busy}>
          {busy ? "بيدور…" : "شوف الغرف المتاحة"}
        </button>
      ) : options.length === 0 ? (
        <div className="banner bad" style={{ margin: 0 }}>
          مفيش غرفة فاضية تستحمل {row.occupancy} أفراد في التواريخ دي.
        </div>
      ) : (
        <>
          <div className="field">
            <label>السبب (اختياري)</label>
            <input value={reason} placeholder="تكييف بايظ"
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
                    {!o.same_type && " — نوع مختلف، السعر ممكن يتغير"}
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
          <input value={reason} placeholder="تكييف بايظ" onChange={(e) => setReason(e.target.value)} />
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
                ? `الغرفة اتعطلت. ${data.length} حجز محتاج نقل — شوف التنبيه فوق.`
                : "الغرفة اتعطلت"
            );
          }}
        >
          أكّد التعطيل
        </button>
        <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </div>
  );
}
