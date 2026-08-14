"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, addDays, nights, dayLabel } from "../../lib/supabase";
import { localePath, localizedName } from "../../lib/locale";
import { useLocale } from "next-intl";

export default function Page() {
  return (
    <Shell>
      {/* The calendar links here with a room and a night already chosen, and
          reading those needs the URL, which is not known while prerendering. */}
      <Suspense fallback={<div className="empty">…</div>}>
        <NewBooking />
      </Suspense>
    </Shell>
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Ordered for a phone call: who's calling, when, which room, done.
function NewBooking() {
  const { property } = useProperty();
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const [toast, showToast] = useToast();

  const presetRoom = params.get("room");
  const presetDate = ISO_DATE.test(params.get("check_in") || "") ? params.get("check_in") : null;

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [guest, setGuest] = useState(null);
  const [searching, setSearching] = useState(false);

  const [checkIn, setCheckIn] = useState(presetDate || today());
  const [checkOut, setCheckOut] = useState(addDays(presetDate || today(), 1));
  const [presetUsed, setPresetUsed] = useState(!presetRoom);

  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");

  const [rooms, setRooms] = useState([]);
  const [picked, setPicked] = useState({});   // room_id -> occupancy
  const [source, setSource] = useState("whatsapp");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);

  const n = nights(checkIn, checkOut);

  useEffect(() => {
    if (!property) return;
    supabase.from("rate_plans").select("*").eq("property_id", property.id)
      .order("sort_order").then(({ data }) => {
        setPlans(data || []);
        setPlanId((data || []).find((p) => p.is_default)?.id || data?.[0]?.id || "");
      });
    supabase.from("accounts").select("*").eq("property_id", property.id)
      .eq("is_active", true).order("name").then(({ data }) => setAccounts(data || []));
  }, [property]);

  // Look up availability whenever the dates make sense.
  useEffect(() => {
    if (!property || n < 1) return setRooms([]);
    supabase.rpc("available_rooms", {
      p_property: property.id, p_check_in: checkIn, p_check_out: checkOut,
    }).then(({ data }) => {
      setRooms(data || []);
      setPicked((prev) => {
        const ok = {};
        (data || []).forEach((r) => { if (prev[r.room_id]) ok[r.room_id] = prev[r.room_id]; });
        return ok;
      });
    });
  }, [property, checkIn, checkOut, n]);

  // A room picked on the calendar is only selected once, and only if it
  // really is free — the availability answer wins over the link.
  useEffect(() => {
    if (presetUsed || rooms.length === 0) return;
    if (rooms.some((r) => r.room_id === presetRoom)) {
      setPicked((prev) => ({ ...prev, [presetRoom]: 2 }));
    }
    setPresetUsed(true);
  }, [rooms, presetRoom, presetUsed]);

  // Price the selection live, so the quote is ready before the guest asks.
  useEffect(() => {
    const ids = Object.keys(picked);
    if (!property || !planId || !ids.length || n < 1) return setQuote(null);

    Promise.all(ids.map(async (rid) => {
      const room = rooms.find((r) => r.room_id === rid);
      if (!room) return 0;
      const { data } = await supabase.rpc("quote_stay", {
        p_property: property.id, p_room_type: room.room_type_id,
        p_rate_plan: planId, p_occupancy: picked[rid],
        p_check_in: checkIn, p_check_out: checkOut,
      });
      return Number(data) || 0;
    })).then((v) => setQuote(v.reduce((a, b) => a + b, 0)));
  }, [picked, planId, rooms, property, checkIn, checkOut, n]);

  async function findGuest() {
    if (!phone.trim() || !property) return;
    setSearching(true);
    const { data } = await supabase.from("guests").select("*")
      .eq("property_id", property.id).eq("phone", phone.trim()).maybeSingle();
    setSearching(false);
    if (data) { setGuest(data); setName(data.full_name); showToast(`نزيل سابق: ${data.full_name}`); }
    else { setGuest(null); showToast("نزيل جديد"); }
  }

  const totalHeads = Object.values(picked).reduce((a, b) => a + b, 0);

  async function submit() {
    if (!name.trim()) return showToast("اكتب اسم النزيل", true);
    if (!Object.keys(picked).length) return showToast("اختار غرفة على الأقل", true);
    setBusy(true);

    let guestId = guest?.id;
    if (!guestId) {
      const { data, error } = await supabase.from("guests").insert({
        property_id: property.id, full_name: name.trim(), phone: phone.trim() || null,
      }).select().single();
      if (error) { setBusy(false); return showToast(error.message, true); }
      guestId = data.id;
    }

    const { data: booking, error } = await supabase.rpc("create_booking", {
      p_property: property.id,
      p_guest_id: guestId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_rooms: Object.entries(picked).map(([room_id, occupancy]) => ({ room_id, occupancy })),
      p_rate_plan: planId || null,
      p_account_id: accountId || null,
      p_source: source,
      p_notes: notes || null,
    });

    setBusy(false);

    if (error) {
      // The exclusion constraint fires if someone took the room first.
      return showToast(
        error.message.includes("exclusion") || error.code === "23P01"
          ? "الغرفة اتحجزت من ثانية. حدّث الصفحة واختار غرفة تانية."
          : error.message,
        true
      );
    }

    showToast(`الحجز اتسجل — ${booking.reference}`);
    setTimeout(() => router.push(localePath("/", locale)), 900);
  }

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>حجز جديد</h2>
      <p className="section-note">ابدأ برقم الموبايل — لو النزيل جه قبل كده هيظهر لوحده.</p>

      <section className="section">
        <div className="card stack">
          <div className="row">
            <div className="field grow">
              <label htmlFor="phone">رقم الموبايل</label>
              <input
                id="phone" className="mono" dir="ltr" style={{ textAlign: "left" }}
                value={phone} placeholder="+2010…"
                onChange={(e) => { setPhone(e.target.value); setGuest(null); }}
                onKeyDown={(e) => e.key === "Enter" && findGuest()}
              />
            </div>
            <button className="btn" onClick={findGuest} disabled={searching}
              style={{ alignSelf: "flex-end" }}>
              {searching ? "…" : "دور"}
            </button>
          </div>

          <div className="field">
            <label htmlFor="name">اسم النزيل</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {guest && (
            <div className="banner ok" style={{ margin: 0 }}>
              نزيل سابق. {guest.notes ? `ملاحظات: ${guest.notes}` : "مفيش ملاحظات."}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="card">
          <div className="row">
            <div className="field grow">
              <label htmlFor="ci">الدخول</label>
              <input id="ci" type="date" className="mono" value={checkIn}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1));
                }} />
            </div>
            <div className="field grow">
              <label htmlFor="co">الخروج</label>
              <input id="co" type="date" className="mono" value={checkOut}
                min={addDays(checkIn, 1)}
                onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <p className="section-note" style={{ margin: "8px 0 0" }}>
            {n > 0 ? `${n} ليلة` : "الخروج لازم يكون بعد الدخول"}
          </p>
        </div>
      </section>

      <section className="section">
        <h2>الغرف الفاضية</h2>
        <p className="section-note">اضغط غرفة تختارها، وحدد عدد الأفراد فيها.</p>

        {rooms.length === 0 ? (
          <div className="empty">مفيش غرف فاضية في التواريخ دي.</div>
        ) : (
          <div className="rack">
            <div className="rail" />
            <div className="rack-grid">
              {rooms.map((r) => {
                const on = picked[r.room_id];
                return (
                  <div key={r.room_id} className="keycard" data-selected={!!on}
                    onClick={() => setPicked((p) => {
                      const next = { ...p };
                      if (next[r.room_id]) delete next[r.room_id];
                      else next[r.room_id] = 2;
                      return next;
                    })}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
                    }}
                  >
                    <div className="num">{r.room_number}</div>
                    <div className="band" style={{ background: on ? "var(--sea)" : undefined }} />
                    <div className="who">{locale === "en" ? (r.type_name_en || r.type_name) : r.type_name}</div>
                    {on && (
                      <select
                        className="mono" style={{ marginTop: 6, padding: "4px 6px", fontSize: 13 }}
                        value={on}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setPicked((p) => ({ ...p, [r.room_id]: Number(e.target.value) }));
                        }}
                      >
                        {[1, 2, 3, 4, 5, 6].map((o) => (
                          <option key={o} value={o}>{o} أفراد</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="card stack">
          <div className="field">
            <label htmlFor="plan">جهة الحجز</label>
            <select id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{localizedName(p, locale)}</option>)}
            </select>
          </div>

          {accounts.length > 0 && (
            <div className="field">
              <label htmlFor="acc">الشركة (اختياري)</label>
              <select id="acc" value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  const a = accounts.find((x) => x.id === e.target.value);
                  if (a?.rate_plan_id) setPlanId(a.rate_plan_id);
                }}>
                <option value="">— بدون —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="src">الحجز جه منين</label>
            <select id="src" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="whatsapp">واتساب</option>
              <option value="phone">مكالمة</option>
              <option value="walk_in">حضر بنفسه</option>
              <option value="referral">توصية</option>
              <option value="other">غير كده</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="notes">ملاحظات</label>
            <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="وصول متأخر، سرير زيادة…" />
          </div>
        </div>
      </section>

      <div className="card" style={{ position: "sticky", bottom: 84, background: "var(--deep)",
        color: "#fff", borderColor: "var(--deep)" }}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, opacity: .8 }}>
              {Object.keys(picked).length} غرفة · {totalHeads} أفراد · {n} ليلة
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
              {quote !== null ? `${egp(quote, locale)} ج` : "—"}
            </div>
          </div>
        </div>
        {quote === 0 && Object.keys(picked).length > 0 && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            السعر صفر — التركيبة دي لسه مالهاش سعر في الإعدادات.
          </div>
        )}
        <button className="btn wide" disabled={busy || !Object.keys(picked).length || n < 1}
          onClick={submit}
          style={{ background: "#fff", color: "var(--deep)", borderColor: "#fff", fontWeight: 600 }}>
          {busy ? "بيسجل…" : "أكّد الحجز"}
        </button>
      </div>
    </>
  );
}
