"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, PenLine } from "lucide-react";
import Shell, { Toast, useProperty, useToast } from "../../components/Shell";
import BookingForm from "../../components/BookingForm";
import { supabase, dayLabel, nights, today } from "../../lib/supabase";
import { useLocale } from "../../lib/locale";
import {
  bookingFormModel, isCurrentStay, manualForm, manualModel, manualProblem, passGaps,
} from "../../lib/booking-form";

export default function Page() {
  return (
    <Shell>
      <Forms />
    </Shell>
  );
}

const SOURCES = ["booking", "manual"];
const RANGES = ["current", "past"];

/**
 * Where the desk makes the hotel's booking confirmation. Two routes to the
 * same paper: pick a booking, or type one out.
 *
 * The screen changes nothing — no route here writes to the database — which
 * is why reception gets it as well as the manager.
 */
function Forms() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("BookingForms");
  const [source, setSource] = useState("booking");
  const [range, setRange] = useState("current");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(manualForm);
  const [open, setOpen] = useState(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id, reference, status, check_in, check_out, adults, children,
        guests(id, full_name, phone, id_number, nationality),
        room_allocations(id, occupancy, released_at, release_reason, rooms(number, room_types(name, name_en)))
      `)
      .eq("property_id", property.id)
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .order("check_in", { ascending: false })
      .limit(300);
    if (error) showToast(error.message, true);
    setRows(data || []);
    setLoading(false);
  }, [property]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const term = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const now = today();
    const inRange = rows.filter((booking) =>
      (range === "current") === isCurrentStay(booking, now));
    const sorted = range === "current"
      ? [...inRange].sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))
      : inRange;
    return term
      ? sorted.filter((b) => b.reference?.toLowerCase().includes(term)
        || b.guests?.full_name?.toLowerCase().includes(term)
        || b.guests?.phone?.includes(term))
      : sorted;
  }, [rows, range, term]);

  const problem = manualProblem(form);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function openManual() {
    if (problem) return showToast(t(`problem_${problem}`), true);
    setOpen({ model: manualModel({ property, form, issuedOn: today() }) });
  }

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>{t("title")}</h2>
      <p className="section-note">{t("subtitle")}</p>

      <div className="tabs" role="tablist">
        {SOURCES.map((key) => (
          <button key={key} className="tab" role="tab" aria-selected={source === key}
            onClick={() => setSource(key)}>{t(`source_${key}`)}</button>
        ))}
      </div>

      {source === "booking" ? (
        <>
          <input
            value={search}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
            style={{ margin: "12px 0" }}
          />
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            {RANGES.map((key) => (
              <button key={key} className="tab" role="tab" aria-selected={range === key}
                onClick={() => setRange(key)}>{t(`range_${key}`)}</button>
            ))}
          </div>

          {loading ? (
            <div className="empty">{t("loading")}</div>
          ) : shown.length === 0 ? (
            <div className="empty">{term ? t("noMatches") : t(`empty_${range}`)}</div>
          ) : (
            <div className="stack">
              {shown.map((booking) => {
                const model = bookingFormModel({
                  property, booking, allocations: booking.room_allocations || [],
                });
                const missingId = passGaps(model).includes("idNumber");
                return (
                  <div className="card" key={booking.id}>
                    <div className="spread" style={{ flexWrap: "wrap", rowGap: 8 }}>
                      <div className="grow">
                        <strong>{booking.guests?.full_name}</strong>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          <span className="code">{booking.reference}</span>{" "}
                          {dayLabel(booking.check_in, locale)} ← {dayLabel(booking.check_out, locale)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                          {t("summary", {
                            nights: nights(booking.check_in, booking.check_out),
                            pax: model.party,
                            rooms: model.roomCount,
                          })}
                        </div>
                        {missingId && <span className="pill warn" style={{ marginTop: 6 }}>{t("missingId")}</span>}
                      </div>
                      <button className="btn primary" onClick={() => setOpen({ booking })}>
                        <FileText size={16} />{t("issue")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          {/* Said before the first field, not after the last: somebody
              filling this in is entitled to know it books nothing. */}
          <div className="banner" style={{ marginBottom: 14 }}>{t("manualIsNotABooking")}</div>

          <div className="field-pairs">
            <div className="field">
              <label htmlFor="bf-guest">{t("field_guest")}</label>
              <input id="bf-guest" value={form.guest} onChange={set("guest")} placeholder={t("placeholder_guest")} />
            </div>
            <div className="field">
              <label htmlFor="bf-idNumber">{t("field_idNumber")}</label>
              <input id="bf-idNumber" value={form.idNumber} onChange={set("idNumber")} inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="bf-nationality">{t("field_nationality")}</label>
              <input id="bf-nationality" value={form.nationality} onChange={set("nationality")} />
            </div>
            <div className="field">
              <label htmlFor="bf-phone">{t("field_phone")}</label>
              <input id="bf-phone" value={form.phone} onChange={set("phone")} inputMode="tel" />
            </div>
            <div className="field">
              <label htmlFor="bf-checkIn">{t("field_checkIn")}</label>
              <input id="bf-checkIn" type="date" value={form.checkIn} onChange={set("checkIn")} />
            </div>
            <div className="field">
              <label htmlFor="bf-checkOut">{t("field_checkOut")}</label>
              <input id="bf-checkOut" type="date" value={form.checkOut} onChange={set("checkOut")} />
            </div>
            <div className="field">
              <label htmlFor="bf-party">{t("field_party")}</label>
              <input id="bf-party" type="number" min="1" value={form.party} onChange={set("party")} />
            </div>
            <div className="field">
              <label htmlFor="bf-rooms">{t("field_rooms")}</label>
              <input id="bf-rooms" value={form.rooms} onChange={set("rooms")} placeholder={t("placeholder_rooms")} />
            </div>
            <div className="field">
              <label htmlFor="bf-reference">{t("field_reference")}</label>
              <input id="bf-reference" value={form.reference} onChange={set("reference")} placeholder={t("placeholder_reference")} />
            </div>
          </div>

          {problem && <p className="section-note" style={{ marginTop: 10 }}>{t(`problem_${problem}`)}</p>}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary grow" onClick={openManual} disabled={Boolean(problem)}>
              <PenLine size={16} />{t("issue")}
            </button>
            <button className="btn" onClick={() => setForm(manualForm())}>{t("clear")}</button>
          </div>
        </div>
      )}

      {open && (
        <BookingForm
          property={property}
          booking={open.booking}
          allocations={open.booking?.room_allocations || []}
          model={open.model}
          onClose={() => setOpen(null)}
          onCopied={() => showToast(t("copied"))}
          onCopyFailed={() => showToast(t("copyFailed"), true)}
        />
      )}
    </>
  );
}
