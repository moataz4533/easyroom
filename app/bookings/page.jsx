"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, dayLabel, nights } from "../../lib/supabase";
import { useOffline } from "../../lib/offline";
import PinPrompt from "../../components/PinPrompt";
import ConfirmationMessage from "../../components/ConfirmationMessage";
import GuestBill from "../../components/GuestBill";
import BookingCharges from "../../components/BookingCharges";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Receipt } from "lucide-react";

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
  ["today", "اليوم"],
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
        id, property_id, reference, status, source, check_in, check_out, adults, children,
        total_amount, paid_amount, notes, attention_reason, cancel_reason,
        guests(id, full_name, phone),
        room_allocations(id, room_id, starts_on, ends_on, occupancy, released_at, rooms(number)),
        payments(id, amount, method, notes, received_at),
        booking_charges(id, charge_item_id, description, quantity, unit_amount, amount, notes, voided_at)
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
    // Keep an open sheet pointing at the fresh copy of its booking, so
    // adding three extras in a row doesn't close it three times.
    setOpen((current) => (current ? (data || []).find((row) => row.id === current.id) || null : null));
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
      <p className="section-note">ابحث بالاسم أو رقم الهاتف أو رقم الحجز.</p>

      <input
        value={search}
        placeholder="ابحث…"
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="tabs" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k} className="tab" role="tab" aria-selected={filter === k}
            onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">جارٍ التحميل…</div>
      ) : shown.length === 0 ? (
        <div className="empty">لا توجد حجوزات هنا.</div>
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
          onNotify={(m) => showToast(m)}
          onRefresh={(m) => { showToast(m); load(); }}
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
  const locale = useLocale();
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
    if (!n || n <= 0) return onError("أدخل مبلغاً صحيحاً");

    setBusy(true);
    const { error } = await supabase.rpc("record_payment", {
      p_booking: b.id,
      p_amount: refund ? -n : n,
      p_method: method,
      p_note: note || null,
    });
    setBusy(false);
    if (error) return onError(error.message);

    onDone(refund ? `تم تسجيل استرداد ${egp(n, locale)} ج` : `تم تسجيل ${egp(n, locale)} ج`);
  }

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 14 }}>الدفعات</h2>
        {owed > 0 ? (
          <span className="pill warn">متبقي {egp(owed, locale)} ج</span>
        ) : owed < 0 ? (
          <span className="pill bad">زيادة {egp(-owed, locale)} ج</span>
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
                  {new Date(p.received_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                  {p.notes && ` · ${p.notes}`}
                </div>
              </div>
              <span className="mono" style={{ fontWeight: 600,
                color: Number(p.amount) < 0 ? "var(--danger)" : "var(--ok)" }}>
                {Number(p.amount) < 0 ? "−" : ""}{egp(Math.abs(p.amount), locale)} ج
              </span>
            </div>
          ))}
        </div>
      )}

      {!online ? (
        <div className="banner warn" style={{ margin: 0 }}>
          تسجيل الدفعات يتطلب اتصالاً — حتى لا يتعارض الرصيد إذا سُجّل من جهازين.
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
            هذا استرداد للنزيل
          </label>

          <button className={`btn wide ${refund ? "danger" : "primary"}`}
            disabled={busy} onClick={submit}>
            {busy ? "جارٍ التسجيل…" : refund ? "تسجيل الاسترداد" : "تسجيل الدفعة"}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>

          <p className="section-note" style={{ margin: 0 }}>
            الدفعات لا تُحذف. يُصحَّح الخطأ باسترداد، حتى يبقى السجل كاملاً.
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
  const locale = useLocale();
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
          {b.attention_reason && <span className="pill warn">يحتاج تدخلاً</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
          <span className="code">{b.reference}</span>{" "}
          {dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}
          {live.length > 0 && ` · غرفة ${live.map((a) => a.rooms?.number).join("، ")}`}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>
        {egp(b.total_amount, locale)} ج
      </div>
    </button>
  );
}

function BookingSheet({ b, role, online, onClose, onDone, onNotify, onRefresh, onError }) {
  const locale = useLocale();
  const { property } = useProperty();
  const t = useTranslations("Confirmation");
  const tb = useTranslations("Bill");
  const [confirmation, setConfirmation] = useState(false);
  const [bill, setBill] = useState(false);
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
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
              {dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}
            </span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {nights(b.check_in, b.check_out)} ليلة · {b.adults} أفراد
            </span>
          </div>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {egp(b.total_amount, locale)} ج
            </span>
            {owed > 0 ? (
              <span className="pill warn">متبقي {egp(owed, locale)} ج</span>
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

        {isOpen && (
          <button className="btn wide" style={{ marginBottom: 12 }}
            onClick={() => setConfirmation(true)}>
            <MessageCircle size={16} />{t("open")}
          </button>
        )}

        {/* Every guest asks for this on the way out, and reception had
            nothing to hand them. */}
        <button className="btn wide" style={{ marginBottom: 12 }} onClick={() => setBill(true)}>
          <Receipt size={16} />{tb("open")}
        </button>

        {bill && (
          <GuestBill
            property={property} booking={b}
            allocations={b.room_allocations || []}
            charges={b.booking_charges || []}
            payments={b.payments || []}
            onClose={() => setBill(false)}
            onCopied={() => onNotify(tb("copied"))}
            onCopyFailed={() => onError(tb("copyFailed"))}
          />
        )}

        {confirmation && (
          <ConfirmationMessage
            property={property} booking={b}
            rooms={live.map((a) => ({ number: a.rooms?.number, occupancy: a.occupancy }))}
            onClose={() => setConfirmation(false)}
            onCopied={() => onNotify(t("copied"))}
            onCopyFailed={() => onError(t("copyFailed"))}
          />
        )}

        {b.attention_reason && (
          <div className="banner bad">{b.attention_reason}</div>
        )}
        {b.cancel_reason && (
          <div className="banner">سبب الإلغاء: {b.cancel_reason}</div>
        )}

        <section className="section">
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>الغرف</h2>
          {live.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>لا توجد غرف على هذا الحجز.</div>
          ) : (
            <div className="stack">
              {live.map((a) => (
                <div key={a.id} className="card spread">
                  <div className="grow">
                    <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                      {a.rooms?.number}
                    </span>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {a.occupancy} أفراد · {dayLabel(a.starts_on, locale)} ← {dayLabel(a.ends_on, locale)}
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
          <BookingCharges
            booking={b} online={online}
            onDone={onRefresh}
            onError={onError}
          />
        )}

        {canManage && (
          <PaymentsSection
            b={b} owed={owed} online={online}
            onDone={onDone} onError={onError}
          />
        )}

        {roomToRelease && (
          <PinPrompt
            title={`إلغاء غرفة ${roomToRelease.rooms?.number}`}
            note="باقي غرف الحجز تبقى كما هي، ويُعدّل الحساب تلقائياً."
            confirmLabel="تأكيد إلغاء الغرفة"
            danger busy={busy}
            onCancel={() => setRoomToRelease(null)}
            onConfirm={(pin) => call("release_booking_room",
              { p_allocation: roomToRelease.id, p_reason: "إلغاء غرفة", p_pin: pin },
              "تم إلغاء الغرفة من الحجز")}
          />
        )}

        {!canManage ? null : !isOpen ? (
          <div className="banner">هذا الحجز مغلق، ولا توجد إجراءات عليه.</div>
        ) : !online ? (
          <div className="banner warn">
            الإلغاء والتعديل يتطلبان اتصالاً — حتى تعود الغرفة للبيع فوراً.
          </div>
        ) : !mode ? (
          <div className="stack">
            {b.status === "checked_in" ? (
              <button className="btn wide" onClick={() => setMode("early")}>
                مغادرة مبكرة (تقصير الإقامة)
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
                ? "النزيل مقيم حالياً. الإلغاء سيُخلي الغرفة فوراً — إذا كان سيغادر مبكراً فاستخدم «مغادرة مبكرة» بدلاً من ذلك."
                : `الغرف (${live.map((a) => a.rooms?.number).join("، ")}) هترجع متاحة للبيع على طول.`}
            </p>
            <div className="field">
              <label>السبب</label>
              <input value={reason} placeholder="النزيل ألغى، ظروف طارئة…"
                onChange={(e) => setReason(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بكلمة مرور المدير"
              confirmLabel="تأكيد الإلغاء"
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("cancel_booking",
                { p_booking: b.id, p_reason: reason || "بدون سبب محدد", p_pin: pin },
                "تم إلغاء الحجز وعادت الغرف متاحة")}
            />
          </div>
        ) : mode === "noshow" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>عدم حضور</h2>
            <p className="section-note" style={{ margin: 0 }}>
              تعود الغرف للبيع فوراً، فما زال من الممكن بيع هذه الليلة.
            </p>
            <div className="field">
              <label>مبلغ يُحتسب عليه (إن وُجد)</label>
              <input type="number" min="0" className="mono" value={charge}
                onChange={(e) => setCharge(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بكلمة مرور المدير"
              confirmLabel="تأكيد عدم الحضور"
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("mark_no_show",
                { p_booking: b.id, p_charge: Number(charge) || 0, p_pin: pin },
                "تم تسجيل عدم الحضور")}
            />
          </div>
        ) : mode === "early" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>مغادرة مبكرة</h2>
            <p className="section-note" style={{ margin: 0 }}>
              تُحذف الليالي التي لن يقيمها من الحساب، وتعود الغرفة للبيع.
            </p>
            <div className="field">
              <label>تاريخ الخروج الجديد</label>
              <input type="date" className="mono" value={newOut}
                min={b.check_in} max={b.check_out}
                onChange={(e) => setNewOut(e.target.value)} />
            </div>
            <PinPrompt
              title="تأكيد بكلمة مرور المدير"
              note="المغادرة المبكرة تُنقص الحساب، ولذلك تتطلب تأكيداً."
              confirmLabel="تأكيد المغادرة المبكرة"
              busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("shorten_stay",
                { p_booking: b.id, p_new_check_out: newOut, p_pin: pin },
                "تم تقصير الإقامة وتعديل الحساب")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
