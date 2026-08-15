"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { supabase } from "../lib/supabase";
import { NATIONALITY_SUGGESTIONS, implausibleFields, missingFields } from "../lib/guest-record";
import { joinList } from "../lib/format";

/**
 * The official record of one guest.
 *
 * Kept as its own component because it is needed in two places: at the desk
 * while the passport is in hand, and later when someone goes back to fill in
 * what was missed.
 */
export default function GuestRecord({ guest, onSaved, onError }) {
  const locale = useLocale();
  const t = useTranslations("Guests");
  const common = useTranslations("Common");
  const [form, setForm] = useState({
    full_name: guest.full_name || "",
    phone: guest.phone || "",
    email: guest.email || "",
    nationality: guest.nationality || "",
    id_number: guest.id_number || "",
    date_of_birth: guest.date_of_birth || "",
    notes: guest.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const missing = missingFields(form, locale);
  // Said, never enforced: whoever is holding the passport can see things
  // this cannot, and a form that blocks is how "123" got into the register.
  const wrong = implausibleFields(form, locale);

  async function save() {
    if (!form.full_name.trim()) return onError(t("nameRequired"));
    setSaving(true);
    const { error } = await supabase.from("guests").update({
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      nationality: form.nationality.trim() || null,
      id_number: form.id_number.trim() || null,
      date_of_birth: form.date_of_birth || null,
      notes: form.notes.trim() || null,
    }).eq("id", guest.id);
    setSaving(false);
    if (error) return onError(error.message);
    onSaved(t("saved"));
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="guest-name">{t("name")}</label>
        <input id="guest-name" value={form.full_name} onChange={set("full_name")} />
      </div>

      <div className="row">
        <div className="field grow">
          <label htmlFor="guest-nationality">{t("nationality")}</label>
          <input id="guest-nationality" list="nationality-options"
            value={form.nationality} onChange={set("nationality")} />
          <datalist id="nationality-options">
            {NATIONALITY_SUGGESTIONS.map((option) => <option key={option} value={option} />)}
          </datalist>
        </div>
        <div className="field grow">
          <label htmlFor="guest-dob">{t("dateOfBirth")}</label>
          <input id="guest-dob" type="date" className="mono"
            value={form.date_of_birth} onChange={set("date_of_birth")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="guest-id">{t("idNumber")}</label>
        <input id="guest-id" className="mono" dir="ltr" style={{ textAlign: "left" }}
          value={form.id_number} onChange={set("id_number")} placeholder={t("idHint")} />
      </div>

      <div className="row">
        <div className="field grow">
          <label htmlFor="guest-phone">{t("phone")}</label>
          <input id="guest-phone" className="mono" dir="ltr" style={{ textAlign: "left" }}
            value={form.phone} onChange={set("phone")} />
        </div>
        <div className="field grow">
          <label htmlFor="guest-email">{t("email")}</label>
          <input id="guest-email" type="email" dir="ltr" style={{ textAlign: "left" }}
            value={form.email} onChange={set("email")} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="guest-notes">{t("notes")}</label>
        <input id="guest-notes" value={form.notes} onChange={set("notes")} placeholder={t("notesHint")} />
      </div>

      {missing.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>
          {t("stillMissing", { fields: joinList(missing, locale) })}
        </div>
      )}

      {wrong.length > 0 && (
        <div className="banner warn" style={{ margin: 0 }}>
          {t("looksWrong", { issues: joinList(wrong.map((issue) => issue.message), locale) })}
        </div>
      )}

      <button className="btn primary wide" disabled={saving} onClick={save}>
        {saving ? common("save") + "…" : common("save")}
      </button>
    </div>
  );
}
