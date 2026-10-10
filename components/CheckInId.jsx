"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { IdCard, LogIn } from "lucide-react";
import { useLocale } from "../lib/locale";
import { joinList } from "../lib/format";
import { NATIONALITY_SUGGESTIONS, checkInIdPatch, implausibleFields } from "../lib/guest-record";

/**
 * The document, asked for while the card is in reception's hand.
 *
 * Shown by the check-in button when the guest has no ID on record. It never
 * stands between a guest and their room: "check in without it" is right
 * there, because a form that blocks gets fed whatever gets past it. What it
 * changes is that the question is asked at the one moment it is easy to
 * answer, instead of weeks later from a list of a hundred blanks.
 */
export default function CheckInId({ booking, onConfirm, onClose }) {
  const locale = useLocale();
  const t = useTranslations("Board");
  const guests = useTranslations("Guests");
  const common = useTranslations("Common");
  const guest = booking.guests || {};
  const [form, setForm] = useState({ id_number: "", nationality: guest.nationality || "" });
  const [busy, setBusy] = useState(false);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const wrong = implausibleFields({ id_number: form.id_number }, locale);
  const patch = checkInIdPatch(form);

  async function go(withId) {
    setBusy(true);
    await onConfirm(withId ? patch : null);
    setBusy(false);
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="card sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row" style={{ gap: 8 }}>
          <IdCard size={20} />
          <h2 style={{ fontSize: 18, margin: 0 }}>{t("idPromptTitle")}</h2>
        </div>
        <p className="section-note" style={{ margin: 0 }}>
          {t("idPromptBody", { name: guest.full_name || "—", reference: booking.reference || "" })}
        </p>

        <div className="field">
          <label htmlFor="checkin-id">{guests("idNumber")}</label>
          <input id="checkin-id" className="mono" dir="ltr" style={{ textAlign: "left" }}
            autoComplete="off" autoFocus value={form.id_number}
            placeholder={guests("idHint")} onChange={set("id_number")} />
        </div>

        <div className="field">
          <label htmlFor="checkin-nationality">{guests("nationality")}</label>
          <input id="checkin-nationality" list="checkin-nationality-options"
            value={form.nationality} onChange={set("nationality")} />
          <datalist id="checkin-nationality-options">
            {NATIONALITY_SUGGESTIONS.map((option) => <option key={option} value={option} />)}
          </datalist>
        </div>

        {wrong.length > 0 && (
          <div className="banner warn" style={{ margin: 0 }}>
            {guests("looksWrong", { issues: joinList(wrong.map((issue) => issue.message), locale) })}
          </div>
        )}

        <button className="btn primary wide" disabled={busy || !patch.id_number} onClick={() => go(true)}>
          <LogIn size={16} />{t("idSaveAndCheckIn")}
        </button>
        <div className="row">
          <button className="btn grow" disabled={busy} onClick={() => go(false)}>
            {t("idCheckInWithout")}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>{common("cancel")}</button>
        </div>
      </div>
    </div>
  );
}
