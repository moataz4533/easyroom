"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase } from "../../lib/supabase";
import { loadCached, queueAdd } from "../../lib/offline";
import { useLocale } from "next-intl";

export default function Page() {
  return (
    <Shell>
      <Housekeeping />
    </Shell>
  );
}

const HK = {
  dirty:        { label: "تحتاج تنظيف", pill: "warn" },
  clean:        { label: "نظيفة",         pill: "ok" },
  inspected:    { label: "تمت مراجعتها",       pill: "ok" },
  out_of_order: { label: "معطلة",         pill: "bad" },
};

// Built for a phone held in one hand: big targets, one tap per room,
// no money and no guest details.
function Housekeeping() {
  const { property } = useProperty();
  const locale = useLocale();
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
      queueAdd({ kind: "room_status", room_id: room.id, status });
      setRooms((prev) => prev.map((r) =>
        r.id === room.id ? { ...r, housekeeping_status: status } : r));
      showToast(`غرفة ${room.number}: ${HK[status].label} — هيتبعت لما النت يرجع`);
      return;
    }

    const { error } = await supabase.rpc("set_housekeeping_status", {
      p_room: room.id, p_status: status,
    });
    if (error) return showToast(error.message, true);
    showToast(`غرفة ${room.number}: ${HK[status].label}`);
    load();
  }

  const pending = rooms.filter((r) => r.housekeeping_status === "dirty");
  const rest = rooms.filter((r) => r.housekeeping_status !== "dirty");

  if (loading) return <div className="empty">جارٍ التحميل…</div>;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>النظافة</h2>
      <p className="section-note">
        {pending.length ? `${pending.length} غرفة تحتاج إجراءً.` : "كل الغرف جاهزة."}
      </p>

      {pending.length > 0 && (
        <section className="section">
          <h2 style={{ fontSize: 14 }}>تحتاج تنظيف</h2>
          <div className="stack">
            {pending.map((r) => (
              <RoomLine key={r.id} room={r} onSet={setStatus} locale={locale} highlight />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 style={{ fontSize: 14 }}>باقي الغرف</h2>
        <div className="stack">
          {rest.map((r) => <RoomLine key={r.id} room={r} onSet={setStatus} locale={locale} />)}
        </div>
      </section>
    </>
  );
}

function RoomLine({ room, onSet, highlight, locale }) {
  const s = HK[room.housekeeping_status] || HK.clean;
  return (
    <div className="card spread"
      style={highlight ? { borderColor: "var(--sand)", background: "#FDFAF3" } : undefined}>
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <span className="mono" style={{ fontSize: 21, fontWeight: 600 }}>{room.number}</span>
          <span className={`pill ${s.pill}`}>{s.label}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {locale === "en" ? (room.type_name_en || room.type_name) : room.type_name}
        </div>
      </div>

      {room.housekeeping_status === "out_of_order" ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>المدير بس</span>
      ) : room.housekeeping_status === "dirty" ? (
        <button className="btn primary" onClick={() => onSet(room, "clean")}>خلصت</button>
      ) : (
        <button className="btn sm" onClick={() => onSet(room, "dirty")}>تحتاج تنظيف</button>
      )}
    </div>
  );
}
