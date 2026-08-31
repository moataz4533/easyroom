"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import Shell, { Toast, useProperty, useToast } from "../../components/Shell";
import CheckpointPass from "../../components/CheckpointPass";
import { supabase, dayLabel, nights, today } from "../../lib/supabase";
import { useLocale } from "../../lib/locale";
import { checkpointPassModel, passGaps } from "../../lib/checkpoint-pass";

export default function Page() {
  return (
    <Shell>
      <Passes />
    </Shell>
  );
}

/**
 * Guests driving to South Sinai are stopped at checkpoints on the way, and
 * the desk was writing them a paper certificate by hand. This screen is the
 * list they work from: every stay that has not ended yet, newest arrival
 * first, one button each. It is a *reading* screen — it changes nothing,
 * which is why reception gets it as well as the manager.
 */
function Passes() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Passes");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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
      .in("status", ["confirmed", "checked_in"])
      .gte("check_out", today())
      .order("check_in", { ascending: true })
      .limit(200);
    if (error) showToast(error.message, true);
    setRows(data || []);
    setOpen((current) => (current ? (data || []).find((row) => row.id === current.id) || null : null));
    setLoading(false);
  }, [property]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const term = search.trim().toLowerCase();
  const shown = useMemo(() => (term
    ? rows.filter((b) => b.reference?.toLowerCase().includes(term)
      || b.guests?.full_name?.toLowerCase().includes(term)
      || b.guests?.phone?.includes(term))
    : rows), [rows, term]);

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>{t("title")}</h2>
      <p className="section-note">{t("subtitle")}</p>

      <input
        value={search}
        placeholder={t("searchPlaceholder")}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 12 }}
      />

      {loading ? (
        <div className="empty">{t("loading")}</div>
      ) : shown.length === 0 ? (
        <div className="empty">{term ? t("noMatches") : t("empty")}</div>
      ) : (
        <div className="stack">
          {shown.map((booking) => {
            const model = checkpointPassModel({
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
                  <button className="btn primary" onClick={() => setOpen(booking)}>
                    <ShieldCheck size={16} />{t("issue")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <CheckpointPass
          property={property}
          booking={open}
          allocations={open.room_allocations || []}
          onClose={() => setOpen(null)}
          onCopied={() => showToast(t("copied"))}
          onCopyFailed={() => showToast(t("copyFailed"), true)}
        />
      )}
    </>
  );
}
