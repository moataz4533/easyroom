"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, today } from "../../lib/supabase";
import { loadCached, queueAdd } from "../../lib/offline";

export default function Page() {
  return (
    <Shell>
      <Housekeeping />
    </Shell>
  );
}

const HK = {
  dirty:        { label: "محتاجة نضافة", pill: "warn" },
  clean:        { label: "نضيفة",         pill: "ok" },
  inspected:    { label: "اتراجعت",       pill: "ok" },
  out_of_order: { label: "معطلة",         pill: "bad" },
};

// Built for a phone held in one hand: big targets, one tap per room,
// no money and no guest details.
function Housekeeping() {
  const { property, role } = useProperty();
  const [rooms, setRooms] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const [{ data: r }, { data: t }] = await Promise.all([
      loadCached(`hk-rooms:${property.id}`, () =>
        supabase.from("rooms")
          .select("id, number, floor, housekeeping_status, room_types(name)")
          .eq("property_id", property.id).eq("is_active", true)),
      loadCached(`hk-tasks:${property.id}`, () =>
        supabase.from("housekeeping_tasks")
          .select("*").eq("property_id", property.id)
          .lte("scheduled_for", today()).neq("status", "done")),
    ]);
    setRooms((r || []).sort((a, b) =>
      String(a.number).localeCompare(String(b.number), "en", { numeric: true })
    ));
    setTasks(t || []);
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

    const { error } = await supabase.from("rooms")
      .update({ housekeeping_status: status }).eq("id", room.id);
    if (error) return showToast(error.message, true);

    // Closing the room's open task keeps the two views in step.
    if (status === "clean" || status === "inspected") {
      const open = tasks.find((t) => t.room_id === room.id);
      if (open) {
        await supabase.from("housekeeping_tasks")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", open.id);
      }
    }
    showToast(`غرفة ${room.number}: ${HK[status].label}`);
    load();
  }

  const pending = rooms.filter((r) => r.housekeeping_status === "dirty");
  const rest = rooms.filter((r) => r.housekeeping_status !== "dirty");

  if (loading) return <div className="empty">بيحمّل…</div>;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>النضافة</h2>
      <p className="section-note">
        {pending.length ? `${pending.length} غرفة محتاجة شغل.` : "كل الغرف مظبوطة."}
      </p>

      {pending.length > 0 && (
        <section className="section">
          <h2 style={{ fontSize: 14 }}>محتاجة نضافة</h2>
          <div className="stack">
            {pending.map((r) => (
              <RoomLine key={r.id} room={r} onSet={setStatus} highlight />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2 style={{ fontSize: 14 }}>باقي الغرف</h2>
        <div className="stack">
          {rest.map((r) => <RoomLine key={r.id} room={r} onSet={setStatus} />)}
        </div>
      </section>
    </>
  );
}

function RoomLine({ room, onSet, highlight }) {
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
          {room.room_types?.name}
        </div>
      </div>

      {room.housekeeping_status === "out_of_order" ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>المدير بس</span>
      ) : room.housekeeping_status === "dirty" ? (
        <button className="btn primary" onClick={() => onSet(room, "clean")}>خلصت</button>
      ) : (
        <button className="btn sm" onClick={() => onSet(room, "dirty")}>محتاجة نضافة</button>
      )}
    </div>
  );
}
