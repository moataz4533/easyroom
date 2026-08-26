"use client";
import { useState } from "react";
import { currencyWord } from "../lib/hotel-settings";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { Tag } from "lucide-react";
import { supabase, egp } from "../lib/supabase";
import { DISCOUNT_KINDS, discountForm, discountProblem } from "../lib/discount";
import PinPrompt from "./PinPrompt";

/**
 * A discount on one room of one booking.
 *
 * Per room rather than per booking because that is how it is given: two
 * rooms on one reservation and only the friend's is cheaper. A booking with
 * a single room — nearly all of them — reads the same either way.
 *
 * Behind the manager password, like every other action that takes money off
 * a bill. Reception deciding on its own what a room costs is the thing a
 * hotel system exists to stop.
 */
export default function RoomDiscount({ allocation, onDone, onError }) {
  const locale = useLocale();
  const t = useTranslations("Discount");
  const common = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => discountForm(allocation));
  const [confirming, setConfirming] = useState(false);

  const given = Number(allocation.discount_amount) || 0;
  const set = (field) => (event) => setForm((c) => ({ ...c, [field]: event.target.value }));

  function review() {
    const problem = discountProblem(form.kind || null, form.value);
    if (problem) return onError(t(problem));
    setConfirming(true);
  }

  async function apply(pin) {
    setBusy(true);
    const { error } = await supabase.rpc("set_allocation_discount", {
      p_allocation: allocation.id,
      p_kind: form.kind || null,
      p_value: form.kind ? Number(form.value) : null,
      p_note: form.note.trim() || null,
      p_pin: pin,
    });
    setBusy(false);
    if (error) return onError(error.message);
    setConfirming(false);
    setOpen(false);
    onDone(form.kind ? t("applied") : t("cleared"));
  }

  async function clear(pin) {
    setBusy(true);
    const { error } = await supabase.rpc("set_allocation_discount", {
      p_allocation: allocation.id, p_kind: null, p_value: null, p_note: null, p_pin: pin,
    });
    setBusy(false);
    if (error) return onError(error.message);
    setConfirming(false);
    setOpen(false);
    setForm({ kind: "", value: "", note: "" });
    onDone(t("cleared"));
  }

  if (!open) {
    return (
      <button className="btn sm" style={{ marginInlineStart: 8 }} onClick={() => setOpen(true)}>
        <Tag size={14} />{given > 0 ? t("change") : t("add")}
      </button>
    );
  }

  return (
    <div className="card stack" style={{ background: "var(--paper)", marginTop: 8, width: "100%" }}>
      <h3 style={{ fontSize: 13, margin: 0 }}>
        {t("title", { room: allocation.rooms?.number || "—" })}
      </h3>

      <div className="field">
        <label htmlFor={`kind-${allocation.id}`}>{t("kind")}</label>
        <select id={`kind-${allocation.id}`} value={form.kind}
          onChange={(event) => setForm((c) => ({ ...c, kind: event.target.value }))}>
          <option value="">{t("kind_none")}</option>
          {DISCOUNT_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(`kind_${kind}`)}</option>
          ))}
        </select>
      </div>

      {form.kind && (
        <>
          <div className="field">
            <label htmlFor={`value-${allocation.id}`}>{t(`value_${form.kind}`)}</label>
            <input id={`value-${allocation.id}`} type="number" min="0" className="mono"
              max={form.kind === "percent" ? 100 : undefined}
              value={form.value} onChange={set("value")} />
          </div>
          <div className="field">
            <label htmlFor={`note-${allocation.id}`}>{t("note")}</label>
            <input id={`note-${allocation.id}`} value={form.note}
              placeholder={t("noteHint")} onChange={set("note")} />
          </div>
          {/* No preview of the new price here on purpose: this screen does
              not hold the nightly rates, and a figure worked out from the
              stay average would be wrong exactly when a season falls inside
              the stay. The saved total below is the real one. */}
          <p className="section-note" style={{ margin: 0 }}>{t("pricedPerNight")}</p>
        </>
      )}

      {given > 0 && (
        <div className="banner ok" style={{ margin: 0 }}>
          {t("currently", { amount: egp(given, locale), currency: currencyWord(locale) })}
        </div>
      )}

      {confirming ? (
        <PinPrompt
          title={form.kind ? t("pinTitle") : t("clearTitle")}
          note={t("pinNote")}
          confirmLabel={form.kind ? t("confirm") : t("clearConfirm")}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={form.kind ? apply : clear}
        />
      ) : (
        <>
          <button className="btn primary wide" disabled={busy || (!form.kind && given === 0)}
            onClick={review}>
            {form.kind ? t("confirm") : t("clearConfirm")}
          </button>
          <button className="btn wide" onClick={() => { setOpen(false); setForm(discountForm(allocation)); }}>
            {common("cancel")}
          </button>
        </>
      )}
    </div>
  );
}
