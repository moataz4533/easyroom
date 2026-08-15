"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { Plus } from "lucide-react";
import { supabase, egp } from "../lib/supabase";
import { localizedName } from "../lib/locale";
import PinPrompt from "./PinPrompt";
import {
  chargesTotal, lineTotal, liveCharges, roomsSubtotal, validateCharge, voidedCharges,
} from "../lib/charges";

/**
 * Extras on one booking.
 *
 * Sits next to the payments section on purpose: what the guest owes and what
 * the guest paid are the same conversation at the desk.
 */
export default function BookingCharges({ booking, online, onDone, onError }) {
  const locale = useLocale();
  const t = useTranslations("Charges");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ item: "", description: "", quantity: "1", amount: "" });

  useEffect(() => {
    if (!booking.property_id) return;
    supabase.from("charge_items").select("*")
      .eq("property_id", booking.property_id).eq("is_active", true)
      .order("sort_order").then(({ data }) => setItems(data || []));
  }, [booking.property_id]);

  const charges = booking.booking_charges || [];
  const live = liveCharges(charges);
  const voided = voidedCharges(charges);
  const extras = chargesTotal(charges);
  const rooms = roomsSubtotal(booking.total_amount, charges);

  // Choosing from the catalogue fills the price in; it stays editable,
  // because a half portion is a real thing at the desk.
  function pickItem(id) {
    const item = items.find((candidate) => candidate.id === id);
    setForm((current) => ({
      ...current,
      item: id,
      description: item ? localizedName(item, locale) : "",
      amount: item ? String(item.default_amount) : current.amount,
    }));
  }

  async function submit() {
    const problem = validateCharge(form);
    if (problem) return onError(t(problem));

    setBusy(true);
    const { error } = await supabase.rpc("add_booking_charge", {
      p_booking: booking.id,
      p_item: form.item || null,
      p_description: form.description.trim(),
      p_quantity: Number(form.quantity),
      p_amount: Number(form.amount),
    });
    setBusy(false);
    if (error) return onError(error.message);

    setForm({ item: "", description: "", quantity: "1", amount: "" });
    setOpen(false);
    onDone(t("added"));
  }

  async function voidLine(pin) {
    setBusy(true);
    const { error } = await supabase.rpc("void_booking_charge", {
      p_charge: voiding.id, p_reason: null, p_pin: pin,
    });
    setBusy(false);
    if (error) return onError(error.message);
    setVoiding(null);
    onDone(t("voided"));
  }

  return (
    <section className="section">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 14 }}>{t("title")}</h2>
        {extras > 0 && <span className="pill dark">{egp(extras, locale)} {t("currency")}</span>}
      </div>

      {live.length > 0 && (
        <div className="stack" style={{ marginBottom: 10 }}>
          {live.map((charge) => (
            <div key={charge.id} className="card spread" style={{ padding: "9px 12px" }}>
              <div className="grow">
                <span style={{ fontSize: 13 }}>{charge.description}</span>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {egp(charge.quantity, locale)} × {egp(charge.unit_amount, locale)} {t("currency")}
                  {charge.notes && ` · ${charge.notes}`}
                </div>
              </div>
              <span className="mono" style={{ fontWeight: 600 }}>
                {egp(charge.amount ?? lineTotal(charge.quantity, charge.unit_amount), locale)} {t("currency")}
              </span>
              {online && (
                <button className="btn sm danger" style={{ marginInlineStart: 8 }}
                  onClick={() => setVoiding(charge)}>
                  {t("void")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* The split the guest asks about: what was the room, what was the rest. */}
      {extras > 0 && (
        <div className="card spread" style={{ background: "var(--paper)", marginBottom: 10, padding: "9px 12px" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("breakdown", { rooms: `${egp(rooms, locale)}`, extras: `${egp(extras, locale)}` })}
          </span>
        </div>
      )}

      {voided.length > 0 && (
        <details style={{ marginBottom: 10 }}>
          <summary className="section-note" style={{ cursor: "pointer" }}>
            {t("voidedCount", { count: voided.length })}
          </summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {voided.map((charge) => (
              <div key={charge.id} className="card spread" style={{ padding: "9px 12px", opacity: .65 }}>
                <span style={{ fontSize: 13, textDecoration: "line-through" }}>{charge.description}</span>
                <span className="mono">{egp(charge.amount, locale)} {t("currency")}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {voiding ? (
        <PinPrompt
          title={t("voidTitle", { description: voiding.description })}
          note={t("voidNote")}
          confirmLabel={t("voidConfirm")}
          danger busy={busy}
          onCancel={() => setVoiding(null)}
          onConfirm={voidLine}
        />
      ) : !online ? (
        <div className="banner warn" style={{ margin: 0 }}>{t("needsNetwork")}</div>
      ) : !open ? (
        <button className="btn ghost wide" onClick={() => setOpen(true)}>
          <Plus size={15} />{t("add")}
        </button>
      ) : (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <div className="field">
            <label htmlFor="charge-item">{t("item")}</label>
            <select id="charge-item" value={form.item} onChange={(event) => pickItem(event.target.value)}>
              <option value="">{t("freeLine")}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{localizedName(item, locale)}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="charge-description">{t("description")}</label>
            <input id="charge-description" value={form.description} placeholder={t("descriptionHint")}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))} />
          </div>

          <div className="row">
            <div className="field grow">
              <label htmlFor="charge-quantity">{t("quantity")}</label>
              <input id="charge-quantity" type="number" min="0" step="0.5" className="mono"
                value={form.quantity}
                onChange={(event) => setForm((c) => ({ ...c, quantity: event.target.value }))} />
            </div>
            <div className="field grow">
              <label htmlFor="charge-amount">{t("unitAmount")}</label>
              <input id="charge-amount" type="number" min="0" className="mono"
                value={form.amount}
                onChange={(event) => setForm((c) => ({ ...c, amount: event.target.value }))} />
            </div>
          </div>

          <div className="spread">
            <span className="section-note" style={{ margin: 0 }}>{t("lineTotal")}</span>
            <strong className="mono">
              {egp(lineTotal(form.quantity, form.amount), locale)} {t("currency")}
            </strong>
          </div>

          <button className="btn primary wide" disabled={busy} onClick={submit}>
            {busy ? t("adding") : t("addConfirm")}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>{t("cancel")}</button>
        </div>
      )}
    </section>
  );
}
