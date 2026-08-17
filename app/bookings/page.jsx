"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, dayLabel, nights } from "../../lib/supabase";
import { useOffline } from "../../lib/offline";
import PinPrompt from "../../components/PinPrompt";
import ConfirmationMessage from "../../components/ConfirmationMessage";
import GuestBill from "../../components/GuestBill";
import BookingCharges from "../../components/BookingCharges";
import RoomDiscount from "../../components/RoomDiscount";
import BookingEdit from "../../components/BookingEdit";
import { stayStarted } from "../../lib/booking-edit";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import { MessageCircle, Receipt } from "lucide-react";
import { joinList } from "../../lib/format";

export default function Page() {
  return (
    <Shell>
      <Bookings />
    </Shell>
  );
}

// The words are in the catalogue; only the colour is a code decision.
const STATUS_PILL = {
  inquiry: "", confirmed: "dark", checked_in: "ok",
  checked_out: "", cancelled: "bad", no_show: "bad",
};

const FILTERS = ["active", "today", "past", "cancelled"];

const METHODS = ["cash", "instapay", "vodafone_cash", "card", "transfer"];

function Bookings() {
  const { property, role } = useProperty();
  const t = useTranslations("Bookings");
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
        room_allocations(id, room_id, starts_on, ends_on, occupancy, released_at, release_reason, rate_per_night, discount_kind, discount_value, discount_note, discount_amount, rooms(number, room_types(max_occupancy))),
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
      <h2 style={{ marginBottom: 4 }}>{t("title")}</h2>
      <p className="section-note">{t("subtitle")}</p>

      <input
        value={search}
        placeholder={t("searchPlaceholder")}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="tabs" role="tablist">
        {FILTERS.map((key) => (
          <button key={key} className="tab" role="tab" aria-selected={filter === key}
            onClick={() => setFilter(key)}>
            {t(`filter_${key}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">{t("loading")}</div>
      ) : shown.length === 0 ? (
        <div className="empty">{t("none")}</div>
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

// Money is the part staff get asked about most, so it sits in the
// booking itself rather than a separate screen.
function PaymentsSection({ b, owed, online, onDone, onError }) {
  const locale = useLocale();
  const t = useTranslations("Bookings");
  const common = useTranslations("Common");
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
    if (!n || n <= 0) return onError(t("needAmount"));

    setBusy(true);
    const { error } = await supabase.rpc("record_payment", {
      p_booking: b.id,
      p_amount: refund ? -n : n,
      p_method: method,
      p_note: note || null,
    });
    setBusy(false);
    if (error) return onError(error.message);

    onDone(t(refund ? "recordedRefund" : "recordedPayment",
      { amount: egp(n, locale), currency: common("currency") }));
  }

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 14 }}>{t("payments")}</h2>
        {owed > 0 ? (
          <span className="pill warn">{t("owed", { amount: egp(owed, locale), currency: common("currency") })}</span>
        ) : owed < 0 ? (
          <span className="pill bad">{t("overpaid", { amount: egp(-owed, locale), currency: common("currency") })}</span>
        ) : (
          <span className="pill ok">{t("paidInFull")}</span>
        )}
      </div>

      {list.length > 0 && (
        <div className="stack" style={{ marginBottom: 10 }}>
          {list.map((p) => (
            <div key={p.id} className="card spread" style={{ padding: "9px 12px" }}>
              <div className="grow">
                <span style={{ fontSize: 13 }}>
                  {METHODS.includes(p.method) ? t(`method_${p.method}`) : p.method}
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
                {Number(p.amount) < 0 ? "−" : ""}{egp(Math.abs(p.amount), locale)} {common("currency")}
              </span>
            </div>
          ))}
        </div>
      )}

      {!online ? (
        <div className="banner warn" style={{ margin: 0 }}>
          {t("paymentsNeedConnection")}
        </div>
      ) : !open ? (
        <button className="btn ghost wide" onClick={() => setOpen(true)}>
          {t("addPayment")}
        </button>
      ) : (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <div className="row">
            <div className="field grow">
              <label>{t("amount")}</label>
              <input type="number" min="0" className="mono" value={amount}
                autoFocus placeholder={owed > 0 ? String(Math.round(owed)) : "0"}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            {owed > 0 && (
              <button className="btn" style={{ alignSelf: "flex-end" }}
                onClick={() => setAmount(String(Math.round(owed)))}>
                {t("allOwed")}
              </button>
            )}
          </div>

          <div className="field">
            <label>{t("method")}</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((key) => (
                <option key={key} value={key}>{t(`method_${key}`)}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t("note")}</label>
            <input value={note} placeholder={t("notePlaceholder")}
              onChange={(e) => setNote(e.target.value)} />
          </div>

          <label className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={refund} style={{ width: "auto" }}
              onChange={(e) => setRefund(e.target.checked)} />
            {t("isRefund")}
          </label>

          <button className={`btn wide ${refund ? "danger" : "primary"}`}
            disabled={busy} onClick={submit}>
            {busy ? t("recording") : refund ? t("recordRefund") : t("recordPayment")}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>{common("cancel")}</button>

          <p className="section-note" style={{ margin: 0 }}>
            {t("paymentsNeverDeleted")}
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
  const t = useTranslations("Bookings");
  const common = useTranslations("Common");
  const status = STATUS_PILL[b.status] !== undefined ? b.status : "confirmed";
  const live = liveRooms(b);

  return (
    <button className="card spread" onClick={onOpen}
      style={{ textAlign: "start", cursor: "pointer", width: "100%",
        fontFamily: "inherit", color: "inherit" }}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{b.guests?.full_name || "—"}</span>
          <span className={`pill ${STATUS_PILL[status]}`}>{t(`status_${status}`)}</span>
          {b.attention_reason && <span className="pill warn">{t("needsAttention")}</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
          <span className="code">{b.reference}</span>{" "}
          {dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}
          {live.length > 0 && ` · ${t("roomsLine", { rooms: joinList(live.map((a) => a.rooms?.number), locale) })}`}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>
        {egp(b.total_amount, locale)} {common("currency")}
      </div>
    </button>
  );
}

function BookingSheet({ b, role, online, onClose, onDone, onNotify, onRefresh, onError }) {
  const locale = useLocale();
  const { property } = useProperty();
  const t = useTranslations("Confirmation");
  const tb = useTranslations("Bill");
  const tk = useTranslations("Bookings");
  const td = useTranslations("Discount");
  const common = useTranslations("Common");
  const [confirmation, setConfirmation] = useState(false);
  const [bill, setBill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);      // cancel | noshow | early | room
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState(0);
  const [newOut, setNewOut] = useState(today());

  const canManage = ["owner", "manager", "reception"].includes(role);
  const status = STATUS_PILL[b.status] !== undefined ? b.status : "confirmed";
  const live = liveRooms(b);
  const isOpen = ["confirmed", "checked_in", "inquiry"].includes(b.status);
  const started = stayStarted(b, today());
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
              <span className={`pill ${STATUS_PILL[status]}`}>{tk(`status_${status}`)}</span>
            </div>
          </div>
          <button className="btn sm" onClick={onClose}>{common("close")}</button>
        </div>

        <div className="card" style={{ background: "var(--paper)", marginBottom: 12 }}>
          <div className="spread">
            <span style={{ fontSize: 13 }}>
              {dayLabel(b.check_in, locale)} ← {dayLabel(b.check_out, locale)}
            </span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {tk("stayLine", { nights: nights(b.check_in, b.check_out), pax: b.adults || 0 })}
            </span>
          </div>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {egp(b.total_amount, locale)} {common("currency")}
            </span>
            {owed > 0 ? (
              <span className="pill warn">{tk("owed", { amount: egp(owed, locale), currency: common("currency") })}</span>
            ) : (
              <span className="pill ok">{tk("paid")}</span>
            )}
          </div>
          {b.guests?.phone && (
            <div className="row" style={{ marginTop: 10 }}>
              <a className="btn sm" href={`tel:${b.guests.phone}`}>{tk("call")}</a>
              <a className="btn sm" target="_blank" rel="noreferrer"
                href={`https://wa.me/${b.guests.phone.replace(/[^\d]/g, "")}`}>{tk("whatsapp")}</a>
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
          <div className="banner">{tk("cancelReason", { reason: b.cancel_reason })}</div>
        )}

        <section className="section">
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>{tk("rooms")}</h2>
          {live.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>{tk("noRooms")}</div>
          ) : (
            <div className="stack">
              {live.map((a) => (
                <div key={a.id} className="card">
                  <div className="spread" style={{ flexWrap: "wrap", rowGap: 8 }}>
                    <div className="grow">
                      <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                        {a.rooms?.number}
                      </span>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {tk("allocationLine", { pax: a.occupancy || 0, from: dayLabel(a.starts_on, locale), to: dayLabel(a.ends_on, locale) })}
                      </div>
                      {/* A discount is a decision somebody made about this
                          room, so it is stated on the room and not only in
                          the total at the bottom. */}
                      {Number(a.discount_amount) > 0 && (
                        <div style={{ fontSize: 12, color: "var(--sea)" }}>
                          {td("onRoom", { amount: egp(a.discount_amount, locale), currency: common("currency") })}
                          {a.discount_note ? ` · ${a.discount_note}` : ""}
                        </div>
                      )}
                    </div>
                    {canManage && isOpen && live.length > 1 && online && (
                      <button className="btn sm danger" disabled={busy}
                        onClick={() => setRoomToRelease(a)}>
                        {tk("releaseRoom")}
                      </button>
                    )}
                    {canManage && isOpen && online && (
                      <RoomDiscount allocation={a} onDone={onDone} onError={onError} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {canManage && isOpen && online && (
          <BookingEdit
            booking={b} allocations={live}
            onDone={onDone} onError={onError}
          />
        )}

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
            title={tk("releaseTitle", { room: roomToRelease.rooms?.number })}
            note={tk("releaseNote")}
            confirmLabel={tk("releaseConfirm")}
            danger busy={busy}
            onCancel={() => setRoomToRelease(null)}
            onConfirm={(pin) => call("release_booking_room",
              { p_allocation: roomToRelease.id, p_reason: tk("releaseReason"), p_pin: pin },
              tk("released"))}
          />
        )}

        {!canManage ? null : !isOpen ? (
          <div className="banner">{tk("closed")}</div>
        ) : !online ? (
          <div className="banner warn">
            {tk("actionsNeedConnection")}
          </div>
        ) : !mode ? (
          <div className="stack">
            {/* Which of the two is offered follows the calendar, not the
                status: a booking entered after the guest arrived never gets
                marked checked-in, and reception was left with "cancel the
                whole booking" for a guest asking to leave a day early. */}
            {started ? (
              <button className="btn wide" onClick={() => setMode("early")}>
                {tk("earlyDeparture")}
              </button>
            ) : (
              <button className="btn wide" onClick={() => setMode("noshow")}>
                {tk("recordNoShow")}
              </button>
            )}
            <button className="btn wide danger" onClick={() => setMode("cancel")}>
              {tk("cancelBooking")}
            </button>
          </div>
        ) : mode === "cancel" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>{tk("cancelTitle")}</h2>
            <p className="section-note" style={{ margin: 0 }}>
              {b.status === "checked_in"
                ? tk("cancelInHouse")
                : tk("cancelFrees", { rooms: joinList(live.map((a) => a.rooms?.number), locale) })}
            </p>
            <div className="field">
              <label>{tk("reason")}</label>
              <input value={reason} placeholder={tk("cancelReasonPlaceholder")}
                onChange={(e) => setReason(e.target.value)} />
            </div>
            <PinPrompt
              title={tk("pinTitle")}
              confirmLabel={tk("cancelConfirm")}
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("cancel_booking",
                { p_booking: b.id, p_reason: reason || tk("noReasonGiven"), p_pin: pin },
                tk("cancelled"))}
            />
          </div>
        ) : mode === "noshow" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>{tk("noShowTitle")}</h2>
            <p className="section-note" style={{ margin: 0 }}>
              {tk("noShowNote")}
            </p>
            <div className="field">
              <label>{tk("noShowFee")}</label>
              <input type="number" min="0" className="mono" value={charge}
                onChange={(e) => setCharge(e.target.value)} />
            </div>
            <PinPrompt
              title={tk("pinTitle")}
              confirmLabel={tk("noShowConfirm")}
              danger busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("mark_no_show",
                { p_booking: b.id, p_charge: Number(charge) || 0, p_pin: pin },
                tk("noShowRecorded"))}
            />
          </div>
        ) : mode === "early" ? (
          <div className="card stack" style={{ background: "var(--paper)" }}>
            <h2 style={{ fontSize: 14 }}>{tk("earlyTitle")}</h2>
            <p className="section-note" style={{ margin: 0 }}>
              {tk("earlyNote")}
            </p>
            <div className="field">
              <label>{tk("newCheckOut")}</label>
              <input type="date" className="mono" value={newOut}
                min={b.check_in} max={b.check_out}
                onChange={(e) => setNewOut(e.target.value)} />
            </div>
            <PinPrompt
              title={tk("pinTitle")}
              note={tk("earlyPinNote")}
              confirmLabel={tk("earlyConfirm")}
              busy={busy}
              onCancel={() => setMode(null)}
              onConfirm={(pin) => call("shorten_stay",
                { p_booking: b.id, p_new_check_out: newOut, p_pin: pin },
                tk("shortened"))}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
