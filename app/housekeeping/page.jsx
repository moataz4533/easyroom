"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase } from "../../lib/supabase";
import { loadCached, queueAdd } from "../../lib/offline";
import { useLocale, useTranslations } from "next-intl";

export default function Page() {
  return (
    <Shell>
      <Housekeeping />
    </Shell>
  );
}

// The words live in the message catalogue; only the colour is a matter of
// code, so only the colour is here.
const PILL = { dirty: "warn", clean: "ok", inspected: "ok", out_of_order: "bad" };

// Built for a phone held in one hand: big targets, one tap per room,
// no money and no guest details.
function Housekeeping() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Housekeeping");
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const { data: r } = await loadCached(`hk-rooms:${property.id}`, () =>
      supabase.rpc("list_housekeeping_rooms", { p_property: property.id }));
    setRooms((r || []).sort((a, b) =>
      String(a.number).localeCompare(String(b.number), "en", { numeric: true })
    ));
    setLoading(false);
  }, [property]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(room, status) {
    // Safe to queue: the last write wins and no money depends on it.
    if (!navigator.onLine) {
      queueAdd({ kind: "room_status", room_id: room.id, status, property_id: property.id });
      setRooms((prev) => prev.map((r) =>
        r.id === room.id ? { ...r, housekeeping_status: status } : r));
      showToast(t("setQueued", { room: room.number, status: t(`status_${status}`) }));
      return;
    }

    const { error } = await supabase.rpc("set_housekeeping_status", {
      p_room: room.id, p_status: status,
    });
    if (error) return showToast(error.message, true);
    showToast(t("set", { room: room.number, status: t(`status_${status}`) }));
    load();
  }

  const pending = rooms.filter((r) => r.housekeeping_status === "dirty");
  const rest = rooms.filter((r) => r.housekeeping_status !== "dirty");

  if (loading) return <div className="empty">{t("loading")}</div>;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>{t("title")}</h2>
      <p className="section-note">
        {pending.length ? t("pending", { count: pending.length }) : t("allReady")}
      </p>

      {pending.length > 0 && (
        <section className="section">
          <h2 style={{ fontSize: 14 }}>{t("needsCleaning")}</h2>
          <div className="stack">
            {pending.map((r) => (
              <RoomLine key={r.id} room={r} onSet={setStatus} locale={locale} t={t} highlight />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 style={{ fontSize: 14 }}>{t("otherRooms")}</h2>
        <div className="stack">
          {rest.map((r) => <RoomLine key={r.id} room={r} onSet={setStatus} locale={locale} t={t} />)}
        </div>
      </section>
    </>
  );
}

function RoomLine({ room, onSet, highlight, locale, t }) {
  const status = PILL[room.housekeeping_status] ? room.housekeeping_status : "clean";
  return (
    <div className="card spread"
      style={highlight ? { borderColor: "var(--sand)", background: "#FDFAF3" } : undefined}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 21, fontWeight: 600 }}>{room.number}</span>
          <span className={`pill ${PILL[status]}`}>{t(`status_${status}`)}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {locale === "en" ? (room.type_name_en || room.type_name) : room.type_name}
        </div>
      </div>

      {room.housekeeping_status === "out_of_order" ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("managersOnly")}</span>
      ) : room.housekeeping_status === "dirty" ? (
        <button className="btn primary" onClick={() => onSet(room, "clean")}>{t("done")}</button>
      ) : (
        <button className="btn sm" onClick={() => onSet(room, "dirty")}>{t("needsCleaning")}</button>
      )}
    </div>
  );
}
