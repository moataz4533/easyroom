"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { editChanges, editForm, editProblem, maxOccupancy } from "../lib/booking-edit";

/**
 * Correcting a booking that is already taken.
 *
 * Reception asked for this on the first day of real use, and every case is
 * ordinary: the name was typed wrong, the room was booked for two and three
 * turned up, a note was missed. Cancelling was the only thing the screen
 * offered for any of it.
 *
 * No manager password. Nothing here moves a room from one date to another or
 * takes money off a bill — it corrects what was written down, and every save
 * is in the activity log under the name of whoever made it. Changing a head
 * count does change what the room costs once rates are entered, which is
 * exactly why it has to be editable in the app rather than remembered.
 */
export default function BookingEdit({ booking, allocations, onDone, onError }) {
  const t = useTranslations("BookingEdit");
  const common = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => editForm(booking, allocations));

  function start() {
    setForm(editForm(booking, allocations));
    setOpen(true);
  }

  async function save() {
    const problem = editProblem(form, allocations);
    if (problem) return onError(t(problem));

    const changes = editChanges(form, booking, allocations);
    if (!changes.any) { setOpen(false); return onDone(t("nothingChanged")); }

    setBusy(true);

    // Each write is checked. A guest rename that succeeded and a head count
    // that failed must not be reported as a save — the screen would show one
    // of the two changes and reception would believe both landed.
    if (changes.guest && booking.guests?.id) {
      const { error } = await supabase.from("guests")
        .update(changes.guest).eq("id", booking.guests.id);
      if (error) { setBusy(false); return onError(error.message); }
    }
    if (changes.booking) {
      const { error } = await supabase.from("bookings")
        .update(changes.booking).eq("id", booking.id);
      if (error) { setBusy(false); return onError(error.message); }
    }
    for (const room of changes.rooms) {
      // The nights trigger fires on occupancy, so the price follows the new
      // head count without this screen knowing the rate matrix exists.
      const { error } = await supabase.from("room_allocations")
        .update({ occupancy: room.occupancy }).eq("id", room.id);
      if (error) { setBusy(false); return onError(error.message); }
    }

    setBusy(false);
    setOpen(false);
    onDone(t("saved"));
  }

  if (!open) {
    return (
      <section className="section">
        <button className="btn ghost wide" onClick={start}>
          <Pencil size={15} />{t("open")}
        </button>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="card stack" style={{ background: "var(--paper)" }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>{t("title")}</h2>
        <p className="section-note" style={{ margin: 0 }}>{t("note")}</p>

        <div className="field">
          <label htmlFor="edit-name">{t("guestName")}</label>
          <input id="edit-name" value={form.full_name}
            onChange={(e) => setForm((c) => ({ ...c, full_name: e.target.value }))} />
        </div>

        <div className="field">
          <label htmlFor="edit-phone">{t("phone")}</label>
          <input id="edit-phone" className="mono" dir="ltr" style={{ textAlign: "left" }}
            value={form.phone}
            onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} />
        </div>

        {allocations.length > 0 && (
          <>
            <p className="section-note" style={{ margin: 0 }}>{t("paxPerRoom")}</p>
            {allocations.map((a) => (
              <div key={a.id} className="spread" style={{ gap: 10 }}>
                <span className="mono" style={{ fontWeight: 600, minWidth: 48 }}>
                  {a.rooms?.number || "—"}
                </span>
                <select
                  className="mono" style={{ width: "auto", minWidth: 110 }}
                  value={form.occupancy[a.id] ?? 1}
                  onChange={(e) => setForm((c) => ({
                    ...c, occupancy: { ...c.occupancy, [a.id]: Number(e.target.value) },
                  }))}
                >
                  {Array.from({ length: maxOccupancy(a) }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{t("paxOption", { count: n })}</option>
                  ))}
                </select>
              </div>
            ))}
          </>
        )}

        <div className="field">
          <label htmlFor="edit-notes">{t("notes")}</label>
          <input id="edit-notes" value={form.notes} placeholder={t("notesHint")}
            onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
        </div>

        <div className="banner" style={{ margin: 0 }}>{t("datesElsewhere")}</div>

        <button className="btn primary wide" disabled={busy} onClick={save}>
          {busy ? common("save") + "…" : common("save")}
        </button>
        <button className="btn wide" onClick={() => setOpen(false)}>{common("cancel")}</button>
      </div>
    </section>
  );
}
