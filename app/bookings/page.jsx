"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, dayLabel, nights } from "../../lib/supabase";
import { useOffline } from "../../lib/offline";
import PinPrompt from "../../components/PinPrompt";

export default function Page() {
  return (
    <Shell>
      <Bookings />
    </Shell>
  );
}

const STATUS = {
  inquiry:     { label: "استفسار",  pill: "" },
  confirmed:   { label: "مؤكد",     pill: "dark" },
  checked_in:  { label: "ساكن",     pill: "ok" },
  checked_out: { label: "خرج",      pill: "" },
  cancelled:   { label: "ملغي",     pill: "bad" },
  no_show:     { label: "لم يحضر",  pill: "bad" },
};

const FILTERS = [
  ["active", "الحالية والقادمة"],
  ["today", "النهاردة"],
  ["past", "المنتهية"],
  ["cancelled", "الملغية"],
];

function Bookings() {
  const { property, role } = useProperty();
  const { online } = useOffline();
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);

    let q = supabase
      .from("bookings")
      .select(`
        id, reference, status, source, check_in, check_out, adults, children,
        total_amount, paid_amount, notes, attention_reason, cancel_reason,
        guests(id, full_name, phone),
        room_allocations(id, room_id, starts_on, ends_on, occupancy, released_at, rooms(number)),
        payments(id, amount, method, notes, received_at)
      `)
      .eq("property_id", property.id);

    if (filter === "active") {
      q = q.in("status", ["confirmed", "checked_in", "inquiry"]).gte("check_out", today());
    } else if (filter === "today") {
      q = q.lte("check_in", today()).gte("check_out", today())
           .in("status", ["confirmed", "checked_in"]);
    } else if (filter === "past") {
      q = q.in("status", ["checked_out"]);
    } else if (filter === "cancelled") {
      q = q.in("status", ["cancelled", "no_show"]);
    }

    const { data, error } = await q.order("check_in", { ascending: filter !== "past" }).limit(200);
    if (error) showToast(error.message, true);

    setRows(data || []);
    setLoading(false);
  }, [property, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const term = search.trim().toLowerCase();
  const shown = term
    ? rows.filter((b) =>
        b.reference?.toLowerCase().includes(term) ||
        b.guests?.full_name?.toLowerCase().includes(term) ||
        b.guests?.phone?.includes(term))
    : rows;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>الحجوزات</h2>
      <p className="section-note">دوّر بالاسم أو رقم الموبايل أو رقم الحجز.</p>

      <input
        value={search}
        placeholder="ابحث…"
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="tabs">
        {FILTERS.map(([k, label]) => (
          <button key={k} className="tab" aria-selected={filter === k}
            onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">بيحمّل…</div>
      ) : shown.length === 0 ? (
        <div className="empty">مفيش حجوزات هنا.</div>
      ) : (
        <div className="stack">
          {shown.map((b) => (
            <BookingRow key={b.id} b={b} onOpen={() => setOpen(b)} />
          ))}
        </div>
      )}

      {open && (
        <BookingSheet
          b={open}
          role={role}
          online={online}
          onClose={() => setOpen(null)}
          onDone={(m) => { showToast(m); setOpen(null); load(); }}
          onError={(m) => showToast(m, true)}
        />
      )}
    </>
  );
}

const METHODS = [
  ["cash", "كاش"],
  ["instapay", "إنستاباي"],
  ["vodafone_cash", "فودافون كاش"],
  ["card", "فيزا"],
  ["transfer", "تحويل بنكي"],
];

const METHOD_LABEL = Object.fromEntries(METHODS);

// Money is the part staff get asked about most, so it sits in the
// booking itself rather than a separate screen.
function PaymentsSection({ b, owed, online, onDone, onError }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = (b.payments || []).slice().sort(
    (x, y) => new Date(y.received_at) - new Date(x.received_at)
  );

  async function submit() {
    const n = Number(amount);
    if (!n || n <= 0) return onError("اكتب مبلغ صحيح");

    setBusy(true);
    const { error } = await supabase.rpc("record_payment", {
      p_booking: b.id,
      p_amount: refund ? -n : n,
      p_method: method,
      p_note: note || null,
    });
    setBusy(false);
    if (error) return onError(error.message);

    onDone(refund ? `اتسجل استرداد ${egp(n)} ج` : `اتسجل ${egp(n)} ج`);
  }

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 14 }}>الدفعات</h2>
        {owed > 0 ? (
          <span className="pill warn">متبقي {egp(owed)} ج</span>
        ) : owed < 0 ? (
          <span className="pill bad">زيادة {egp(-owed)} ج</span>
        ) : (
          <span className="pill ok">مدفوع بالكامل</span>
        )}
      </div>

      {list.length > 0 && (
        <div className="stack" style={{ marginBottom: 10 }}>
          {list.map((p) => (
            <div key={p.id} className="card spread" style={{ padding: "9px 12px" }}>
              <div className="grow">
                <span style={{ fontSize: 13 }}>
                  {METHOD_LABEL[p.method] || p.method}
                </span>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {new Date(p.received_at).toLocaleString("ar-EG", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                  {p.notes && ` · ${p.notes}`}
                </div>
              </div>
              <span className="mono" style={{ fontWeight: 600,
                color: Number(p.amount) < 0 ? "var(--danger)" : "var(--ok)" }}>
                {Number(p.amount) < 0 ? "−" : ""}{egp(Math.abs(p.amount))} ج
              </span>
            </div>
          ))}
        </div>
      )}

      {!online ? (
        <div className="banner warn" style={{ margin: 0 }}>
          تسجيل الدفعات محتاج نت — عشان الرصيد ميتعارضش لو اتسجل من جهازين.
        </div>
      ) : !open ? (
        <button className="btn ghost wide" onClick={() => setOpen(true)}>
          ＋ تسجيل دفعة
        </button>
      ) : (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <div className="row">
            <div className="field grow">
              <label>المبلغ</label>
              <input type="number" min="0" className="mono" value={amount}
                autoFocus placeholder={owed > 0 ? String(Math.round(owed)) : "0"}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            {owed > 0 && (
              <button className="btn" style={{ alignSelf: "flex-end" }}
                onClick={() => setAmount(String(Math.round(owed)))}>
                المتبقي كله
              </button>
            )}
          </div>

          <div className="field">
            <label>طريقة الدفع</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>ملاحظة</label>
            <input value={note} placeholder="عربون، باقي الحساب…"
              onChange={(e) => setNote(e.target.value)} />
          </div>

          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={refund} style={{ width: "auto" }}
              onChange={(e) => setRefund(e.target.checked)} />
            ده استرداد للنزيل
          </label>

          <button className={`btn wide ${refund ? "danger" : "primary"}`}
            disabled={busy} onClick={submit}>
            {busy ? "بيسجل…" : refund ? "سجّل الاسترداد" : "سجّل الدفعة"}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>

          <p className="section-note" style={{ margin: 0 }}>
            الدفعات مبتتمسحش. الغلط بيتصحح باسترداد، عشان السجل يفضل كامل.
          </p>
        </div>
      )}
    </section>
  );
}

function liveRooms(b) {
  return (b.room_allocations || []).filter((a) => !a.released_at);
}

function BookingRow({ b, onOpen }) {
  const s = STATUS[b.status] || STATUS.confirmed;
  const live = liveRooms(b);

  return (
    <button className="card spread" onClick={onOpen}
      style={{ textAlign: "start", cursor: "pointer", width: "100%",
        fontFamily: "inherit", color: "inherit" }}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{b.guests?.full_name || "—"}</span>
          <span className={`pill ${s.pill}`}>{s.label}</span>
          {b.attention_reason && <span className="pill warn">محتاج تدخل</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
          <span className="code">{b.reference}</span>{" "}
          {dayLabel(b.check_in)} ← {dayLabel(b.check_out)}
          {live.length > 0 && ` · غرفة ${live.map((a) => a.rooms?.number).join("، ")}`}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>
        {egp(b.total_amount)} ج
      </div>
    </button>
  );
}

function BookingSheet({ b, role, online, onClose, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);      // cancel | noshow | early | room
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState(0);
  const [newOut, setNewOut] = useState(today());

  const canManage = ["owner", "manager", "reception"].includes(role);
  const s = STATUS[b.status] || STATUS.confirmed;
  const live = liveRooms(b);
  const isOpen = ["confirmed", "checked_in", "inquiry"].includes(b.status);
  const owed = Number(b.total_amount) - Number(b.paid_amount);

  async function call(fn, args, msg) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return onError(error.message);
    onDone(msg);
  }

  // Releasing one room from a group is a cancellation too, so it asks
  // for the PIN like the rest.
  const [roomToRelease, setRoomToRelease] = useState(null);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(11,58,70,.5)",
        display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div className="card"
        style={{ width: "100%", maxWidth: 480, borderRadius: "14px 14px 0 0",
          maxHeight: "90vh", overflowY: "auto", paddingBottom: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18 }}>{b.guests?.full_name}</h2>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              <span className="code">{b.reference}</span>{" "}
              <span className={`pill ${s.pill}`}>{s.label}</span>
            </div>
          </div>
          <button className="btn sm" onClick={onClose}>إغلاق</button>
        </div>

        <div className="card" style={{ background: "var(--paper)", marginBottom: 12 }}>
          <div className="spread">
            <span style={{ fontSize: 13 }}>
              {dayLabel(b.check_in)} ← {dayLabel(b.check_out)}
            </span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {nights(b.check_in, b.check_out)} ليلة · {b.adults} أفراد
            </span>
          </div>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {egp(b.total_amount)} ج
            </span>
            {owed > 0 ? (
              <span className="pill warn">متبقي {egp(owed)} ج</span>
            ) : (
              <span className="pill ok">مدفوع</span>
            )}
          </div>
          {b.guests?.phone && (
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn sm" href={`tel:${b.guests.phone}`}>اتصل</a>
              <a className="btn sm" target="_blank" rel="noreferrer"
                href={`https://wa.me/${b.guests.phone.replace(/[^\d]/g, "")}`}>واتساب</a>
            </div>
          )}
        </div>

        {b.attention_reason && (
          <div className="banner bad">{b.attention_reason}</div>
        )}
        {b.cancel_reason && (
          <div className="banner">سبب الإلغاء: {b.cancel_reason}</div>
        )}

        <section className="section">
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>الغرف</h2>
          {live.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>مفيش غرف على الحجز ده.</div>
          ) : (
            <div className="stack">
              {live.map((a) => (
                <div key={a.id} className="card spread">
                  <div className="grow">
                    <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                      {a.rooms?.number}
                    </span>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {a.occupancy} أفراد · {dayLabel(a.starts_on)} ← {dayLabel(a.ends_on)}
                    </div>
                  </div>
                  {canManage && isOpen && live.length > 1 && online && (
                    <button className="btn sm danger" disabled={busy}
                      onClick={() => setRoomToRelease(a)}>
                      إلغاء الغرفة
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {canManage && (
          <PaymentsSection
            b={b} owed={owed} online={online}
            onDone={onDone} onError={onError}
          />
        )}

        {roomToRelease && (
          <PinPrompt
            title={`إلغاء غرفة ${roomToRelease.rooms?.number}`}
            note="باقي غرف الحجز هتفضل زي ما هي، والحساب هيتظبط."
            confirmLabel="أكّد إلغاء الغرفة"
            danger busy={busy}
            onCancel={() => setRoomToRelease(null)}
            onConfirm={(pin) => call("release_booking_room",
              { p_allocation: roomToRelease.id, p_reason: "إلغاء غرفة", p_pin: pin },
              "الغرفة اتلغت من الحجز")}
          />
        )}

        {!canManage ? null : !isOpen ? (
          <div className="banner">الحجز ده مقفول، مفيش إجراءات عليه.</div>
        ) : !online ? (
          <div className="banner warn">
            الإلغاء والتعديل محتاجين نت — عشان الغرفة تترجع للبيع فوراً.
          </div>
        ) : !mode ? (
          <div className="stack">
            {b.status === "checked_in" ? (
              <button className="btn wide" onClick={() => setMode("early")}>
                خروج بدري (تقصير الإقامة)
              </button>
            ) : (
              <button className="btn wide" onClick={() => setMode("noshow")}>
                تسجيل عدم حضور
              </button>
            )}
            <button className="btn wide danger" onClick={() => setMode("cancel")}>
              إلغاء الحجز بالكامل
            </button>
          </div>
        ) : mode === "cancel" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>إلغاء الحجز</h2>
            <p className="section-note" style={{ margin: 0 }}>
              {b.status === "checked_in"
                ? "النزيل ساكن دلوقتي. الإلغاء هيفضي الغرفة فوراً — لو هو خارج بدري استخدم «خروج بدري» بدل كده."
                : `الغرف (${live.map((a) => a.rooms?.number).join("، ")}) هترجع متاحة للبيع على طول.`}
            </p>
            <div className="field">
              <label>السبب</label>
              <input value={reason} placeholder="النزيل ألغى، ظروف طارئة…"
                onChange={(e) => setReason(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بباسورد المدير"
              confirmLabel="أكّد الإلغاء"
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("cancel_booking",
                { p_booking: b.id, p_reason: reason || "بدون سبب محدد", p_pin: pin },
                "الحجز اتلغى والغرف رجعت متاحة")}
            />
          </div>
        ) : mode === "noshow" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>عدم حضور</h2>
            <p className="section-note" style={{ margin: 0 }}>
              الغرف هترجع للبيع على طول، عشان لسه ممكن تتباع الليلادي.
            </p>
            <div className="field">
              <label>مبلغ يتحمّل عليه (لو في)</label>
              <input type="number" min="0" className="mono" value={charge}
                onChange={(e) => setCharge(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بباسورد المدير"
              confirmLabel="أكّد عدم الحضور"
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("mark_no_show",
                { p_booking: b.id, p_charge: Number(charge) || 0, p_pin: pin },
                "اتسجل عدم حضور")}
            />
          </div>
        ) : mode === "early" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>خروج بدري</h2>
            <p className="section-note" style={{ margin: 0 }}>
              الليالي اللي مش هيقعدها هتتشال من الحساب، والغرفة ترجع للبيع.
            </p>
            <div className="field">
              <label>تاريخ الخروج الجديد</label>
              <input type="date" className="mono" value={newOut}
                min={b.check_in} max={b.check_out}
                onChange={(e) => setNewOut(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بباسورد المدير"
              note="الخروج البدري بيقلل الحساب، عشان كده محتاج تأكيد."
              confirmLabel="أكّد الخروج البدري"
              busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("shorten_stay",
                { p_booking: b.id, p_new_check_out: newOut, p_pin: pin },
                "الإقامة اتقصرت والحساب اتظبط")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
