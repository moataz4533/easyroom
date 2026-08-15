"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, addDays, nights, dayLabel } from "../../lib/supabase";
import { localePath, localizedName } from "../../lib/locale";
import { isReturning, isUnreliable, summariseStays } from "../../lib/guest-history";
import { duplicateCount, guestToReuse, normalisePhone, pickGuest } from "../../lib/guest-match";
import { implausibleFields } from "../../lib/guest-record";
import PasteMessage from "../../components/PasteMessage";
import { loadCached, provisionalAdd, provisionalList, useOffline } from "../../lib/offline";
import {
  newProvisional, roomsHeldOn, roomsWantedByDrafts, validateProvisional,
} from "../../lib/provisional";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquareText } from "lucide-react";

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

// "We could not work the price out" — deliberately not a number, so it can
// never be added up, compared, or mistaken for a cheap night.
const UNPRICED = Symbol("unpriced");

// Ordered for a phone call: who's calling, when, which room, done.
function NewBooking() {
  const { property } = useProperty();
  const router = useRouter();
  const locale = useLocale();
  const params = useSearchParams();
  const [toast, showToast] = useToast();
  const t = useTranslations("Provisional");
  const tg = useTranslations("Guests");
  const tp = useTranslations("Paste");
  const { online } = useOffline();

  const presetRoom = params.get("room");
  const presetDate = ISO_DATE.test(params.get("check_in") || "") ? params.get("check_in") : null;

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [guest, setGuest] = useState(null);
  const [history, setHistory] = useState(null);
  const [searching, setSearching] = useState(false);
  const [duplicates, setDuplicates] = useState(0);
  const [pasting, setPasting] = useState(false);
  // What the message asked for but the form has no box for. Kept as advice
  // next to the room list rather than acted on: which rooms are free is the
  // screen's answer, not the message's.
  const [asked, setAsked] = useState(null);

  const [checkIn, setCheckIn] = useState(presetDate || today());
  const [checkOut, setCheckOut] = useState(addDays(presetDate || today(), 1));
  const [presetUsed, setPresetUsed] = useState(!presetRoom);

  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");

  const [rooms, setRooms] = useState([]);
  // Enough saved on the device to take a booking with no connection: which
  // rooms exist, and what the last data we saw says is already taken.
  const [savedRooms, setSavedRooms] = useState([]);
  const [savedHolds, setSavedHolds] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [picked, setPicked] = useState({});   // room_id -> occupancy
  const [source, setSource] = useState("whatsapp");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);

  const n = nights(checkIn, checkOut);

  // The register is only as good as what is typed here. Said out loud and
  // never blocked: the desk still takes the booking, and a guest with no
  // papers at 2am is a real guest. What this stops is the silent version,
  // where "123" goes in and nobody sees it again until an inspection.
  const suspect = implausibleFields({ full_name: name, phone }, locale);

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

  // Look up availability whenever the dates make sense. Offline there is no
  // availability to look up, so the saved room list stands in for it.
  useEffect(() => {
    if (!property || n < 1 || !online) return setRooms([]);
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
  }, [property, checkIn, checkOut, n, online]);

  // Refreshed whenever this screen is opened with a connection, so the copy
  // on the device is the one from the last time reception was online — not
  // from whenever the app was installed.
  useEffect(() => {
    if (!property) return;
    loadCached(`rooms:${property.id}`, () =>
      supabase.from("rooms").select("id, number, room_types(name, name_en)")
        .eq("property_id", property.id).eq("is_active", true)
    ).then(({ data }) => setSavedRooms(data || []));

    loadCached(`holds:${property.id}`, () =>
      supabase.from("room_allocations").select("room_id, starts_on, ends_on")
        .eq("property_id", property.id).is("released_at", null).gte("ends_on", today())
    ).then(({ data }) => setSavedHolds(data || []));
  }, [property]);

  useEffect(() => {
    const read = () => setDrafts(provisionalList());
    read();
    window.addEventListener("easyroom:provisional", read);
    return () => window.removeEventListener("easyroom:provisional", read);
  }, []);

  // One shape for the picker, whichever answer it came from.
  const choices = online
    ? rooms.map((r) => ({
        id: r.room_id, number: r.room_number,
        type: locale === "en" ? (r.type_name_en || r.type_name) : r.type_name,
      }))
    : [...savedRooms]
        .sort((a, b) => String(a.number).localeCompare(String(b.number), "en", { numeric: true }))
        .map((r) => ({ id: r.id, number: r.number, type: localizedName(r.room_types, locale) }));

  // Offline the app cannot ask what is free, so it says what it last knew
  // instead of pretending to know now.
  const held = online ? new Set() : roomsHeldOn(savedHolds, checkIn, checkOut);
  const draftHeld = online ? new Set() : roomsWantedByDrafts(drafts, checkIn, checkOut);

  // A room picked on the calendar is only selected once, and only if it
  // really is free — the availability answer wins over the link.
  useEffect(() => {
    if (presetUsed || rooms.length === 0) return;
    if (rooms.some((r) => r.room_id === presetRoom)) {
      setPicked((prev) => ({ ...prev, [presetRoom]: 2 }));
    }
    setPresetUsed(true);
  }, [rooms, presetRoom, presetUsed]);

  /**
   * Price the selection live, so the quote is ready before the guest asks.
   *
   * A leg that fails makes the whole quote unknown rather than cheaper. The
   * old code read a failed call as zero, which put "٠ ج" on the screen with
   * exactly the confidence of a real price — the one number reception must
   * never be given wrongly.
   */
  useEffect(() => {
    const ids = Object.keys(picked);
    if (!property || !planId || !ids.length || n < 1 || !online) return setQuote(null);

    let current = true;
    Promise.all(ids.map(async (rid) => {
      const room = rooms.find((r) => r.room_id === rid);
      if (!room) return 0;
      const { data, error } = await supabase.rpc("quote_stay", {
        p_property: property.id, p_room_type: room.room_type_id,
        p_rate_plan: planId, p_occupancy: picked[rid],
        p_check_in: checkIn, p_check_out: checkOut,
      });
      if (error) throw error;
      return Number(data) || 0;
    }))
      .then((v) => { if (current) setQuote(v.reduce((a, b) => a + b, 0)); })
      .catch(() => { if (current) setQuote(UNPRICED); });
    // A slow answer for a selection reception has already changed is not an
    // answer to anything, so it is dropped rather than shown.
    return () => { current = false; };
  }, [picked, planId, rooms, property, checkIn, checkOut, n, online]);

  /**
   * A read message fills the boxes it filled and leaves the rest alone, so
   * pasting over a form somebody has already started cannot wipe their work.
   */
  function useDraft(draft) {
    if (draft.phone) { setPhone(draft.phone.value); setGuest(null); setHistory(null); }
    if (draft.name) setName(draft.name.value);
    if (draft.checkIn) setCheckIn(draft.checkIn.value);
    if (draft.checkOut) setCheckOut(draft.checkOut.value);
    setAsked(draft.pax || draft.rooms
      ? { pax: draft.pax?.value || null, rooms: draft.rooms?.value || null }
      : null);
    setPasting(false);
    showToast(tp("filled"));
  }

  async function findGuest() {
    if (!phone.trim() || !property) return;
    setSearching(true);

    // Several rows can carry one number — every booking taken without
    // searching first makes another. Asking for exactly one used to fail
    // outright on those numbers, which is the opposite of helpful.
    const { data: matches, error } = await supabase.from("guests").select("*")
      .eq("property_id", property.id).eq("phone", phone.trim());

    // "New guest" is an answer, and a failed search has not earned it: the
    // number may well belong to somebody who has stayed here five times.
    if (error) {
      setSearching(false);
      return showToast("تعذّر البحث. جرّب تاني.", true);
    }

    const found = pickGuest(matches || []);
    setDuplicates(duplicateCount(matches || []));

    // How often they have stayed, and whether they have failed to turn up,
    // is worth knowing before promising the last room on a busy night. If
    // that part fails the guest is still shown — with no history rather
    // than an empty one, which would read as a first-time visitor.
    let past = null;
    if (found) {
      const { data: bookings, error: historyFailed } = await supabase.from("bookings")
        .select("status, check_in, check_out, total_amount, paid_amount")
        .eq("guest_id", found.id).limit(100);
      if (!historyFailed) past = bookings || [];
    }

    setSearching(false);
    setHistory(found && past ? summariseStays(past) : null);
    if (found) { setGuest(found); setName(found.full_name); showToast(`نزيل سابق: ${found.full_name}`); }
    else { setGuest(null); showToast("نزيل جديد"); }
  }

  const totalHeads = Object.values(picked).reduce((a, b) => a + b, 0);

  /**
   * With no connection nothing can be held: the room is only reserved when
   * the request reaches the database. So this writes the booking down as
   * provisional and says so — it does not pretend to have confirmed it.
   */
  function recordProvisional() {
    const record = newProvisional({
      propertyId: property.id,
      guestName: name, guestPhone: phone,
      checkIn, checkOut,
      rooms: picked,
      roomLabels: Object.fromEntries(
        Object.keys(picked).map((id) => [id, choices.find((c) => c.id === id)?.number || id])
      ),
      ratePlanId: planId || null,
      source, notes,
    });

    const problems = validateProvisional(record);
    if (problems.includes("name")) return showToast("أدخل اسم النزيل", true);
    if (problems.includes("rooms")) return showToast("اختر غرفة واحدة على الأقل", true);
    if (problems.length) return showToast("راجع التواريخ", true);

    setBusy(true);
    try {
      provisionalAdd(record);
    } catch (e) {
      setBusy(false);
      return showToast(String(e?.message || e), true);
    }
    setBusy(false);
    showToast(t("recorded", { name: record.guestName }));
    setTimeout(() => router.push(localePath("/", locale)), 900);
  }

  async function submit() {
    if (!online) return recordProvisional();
    if (!name.trim()) return showToast("أدخل اسم النزيل", true);
    if (!Object.keys(picked).length) return showToast("اختر غرفة واحدة على الأقل", true);
    setBusy(true);

    let guestId = guest?.id;
    if (!guestId && normalisePhone(phone)) {
      // Reception who types the number and goes straight to the rooms without
      // pressing search should still land on the guest already on file. This
      // is why one number ended up with twelve rows behind it.
      const { data: onFile, error: lookupFailed } = await supabase.from("guests").select("*")
        .eq("property_id", property.id).eq("phone", phone.trim());

      // A lookup that failed is not a lookup that found nobody. Carrying on
      // here would add another row for a guest already on file — which is
      // the very thing this lookup exists to prevent, defeated at exactly
      // the moment the connection is bad enough to matter.
      if (lookupFailed) {
        setBusy(false);
        return showToast("تعذّر البحث عن النزيل. حاول مرة أخرى قبل تسجيل الحجز.", true);
      }
      guestId = guestToReuse(onFile || [], { name, phone })?.id;
    }
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
          ? "تم حجز الغرفة منذ لحظات. حدّث الصفحة واختر غرفة أخرى."
          : error.message,
        true
      );
    }

    showToast(`تم تسجيل الحجز — ${booking.reference}`);
    setTimeout(() => router.push(localePath("/", locale)), 900);
  }

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>حجز جديد</h2>
      <p className="section-note">ابدأ برقم الهاتف — إذا سبق للنزيل الإقامة ستظهر بياناته تلقائياً.</p>

      {!online && <div className="banner warn">{t("offlineNotice")}</div>}

      {pasting && (
        <PasteMessage today={today()} onUse={useDraft} onClose={() => setPasting(false)} />
      )}

      <section className="section">
        <div className="card stack">
          {/* Nearly every booking arrives as a message. Reading it beats
              retyping it, and it sits above the first box for that reason. */}
          <button className="btn ghost wide" onClick={() => setPasting(true)}>
            <MessageSquareText size={16} />{tp("open")}
          </button>

          <div className="row">
            <div className="field grow">
              <label htmlFor="phone">رقم الهاتف</label>
              <input
                id="phone" className="mono" dir="ltr" style={{ textAlign: "left" }}
                value={phone} placeholder="+2010…"
                onChange={(e) => { setPhone(e.target.value); setGuest(null); setHistory(null); }}
                onKeyDown={(e) => e.key === "Enter" && findGuest()}
              />
            </div>
            <button className="btn" onClick={findGuest} disabled={searching}
              style={{ alignSelf: "flex-end" }}>
              {searching ? "…" : "بحث"}
            </button>
          </div>

          <div className="field">
            <label htmlFor="name">اسم النزيل</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {guest && (
            <div className="banner ok" style={{ margin: 0 }}>
              {history && isReturning(history)
                ? `نزيل عائد — أقام ${egp(history.stays, locale)} مرات، آخرها ${dayLabel(history.lastVisit, locale)}.`
                : "نزيل سابق."}
              {" "}{guest.notes ? `ملاحظات: ${guest.notes}` : "لا توجد ملاحظات."}
            </div>
          )}

          {suspect.length > 0 && (
            <div className="banner warn" style={{ margin: 0 }}>
              {tg("looksWrong", { issues: suspect.map((issue) => issue.message).join("، ") })}
              {" "}{tg("carryOnAnyway")}
            </div>
          )}

          {duplicates > 0 && (
            <div className="banner warn" style={{ margin: 0 }}>
              {t("duplicates", { count: duplicates })}
            </div>
          )}

          {history && isUnreliable(history) && (
            <div className="banner bad" style={{ margin: 0 }}>
              هذا النزيل لم يحضر {egp(history.noShows, locale)} مرات سابقاً.
            </div>
          )}

          {history && history.outstanding > 0 && (
            <div className="banner warn" style={{ margin: 0 }}>
              عليه متبقٍ {egp(history.outstanding, locale)} ج من إقامة سابقة.
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
            {n > 0 ? `${n} ليلة` : "تاريخ المغادرة يجب أن يكون بعد الوصول"}
          </p>
        </div>
      </section>

      <section className="section">
        <h2>الغرف الشاغرة</h2>
        <p className="section-note">
          {online ? "اضغط على غرفة لاختيارها، وحدد عدد الأفراد بها." : t("availabilityUnknown")}
        </p>

        {/* What the message asked for, next to the rooms that are actually
            free — the screen decides which, this only says what was wanted. */}
        {asked && (
          <div className="banner" style={{ marginTop: 0 }}>
            {tp("asked", { rooms: asked.rooms ?? 0, pax: asked.pax ?? 0 })}
          </div>
        )}

        {choices.length === 0 ? (
          <div className="empty">
            {online ? "لا توجد غرف شاغرة في هذه التواريخ." : t("noSavedRooms")}
          </div>
        ) : (
          <div className="rack">
            <div className="rail" />
            <div className="rack-grid">
              {choices.map((r) => {
                const on = picked[r.id];
                const warn = draftHeld.has(r.id) ? t("conflictsDraft")
                  : held.has(r.id) ? t("heldByCache") : null;
                return (
                  <div key={r.id} className="keycard" data-selected={!!on} data-warn={!!warn}
                    onClick={() => setPicked((p) => {
                      const next = { ...p };
                      if (next[r.id]) delete next[r.id];
                      else next[r.id] = 2;
                      return next;
                    })}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); }
                    }}
                  >
                    <div className="num">{r.number}</div>
                    <div className="band" style={{ background: on ? "var(--sea)" : undefined }} />
                    <div className="who">{r.type}</div>
                    {/* Marked, not forbidden: the saved copy may be out of
                        date, and the guest on the phone is not. */}
                    {warn && <div className="keycard-warn">{warn}</div>}
                    {on && (
                      <select
                        className="mono" style={{ marginTop: 6, padding: "4px 6px", fontSize: 13 }}
                        value={on}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setPicked((p) => ({ ...p, [r.id]: Number(e.target.value) }));
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
            <label htmlFor="src">مصدر الحجز</label>
            <select id="src" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="whatsapp">واتساب</option>
              <option value="phone">مكالمة</option>
              <option value="walk_in">حضور مباشر</option>
              <option value="referral">توصية</option>
              <option value="other">أخرى</option>
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
              {typeof quote === "number" ? `${egp(quote, locale)} ج` : "—"}
            </div>
          </div>
        </div>
        {quote === UNPRICED && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            تعذّر حساب السعر — راجع الاتصال. لا تؤكد الحجز بسعر غير ظاهر.
          </div>
        )}
        {online && quote === 0 && Object.keys(picked).length > 0 && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            السعر صفر — هذه التركيبة ليس لها سعر بعد في الإعدادات.
          </div>
        )}
        {!online && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            {t("noPrice")}
          </div>
        )}
        <button className="btn wide" disabled={busy || !Object.keys(picked).length || n < 1}
          onClick={submit}
          style={{ background: "#fff", color: "var(--deep)", borderColor: "#fff", fontWeight: 600 }}>
          {busy
            ? (online ? "جارٍ التسجيل…" : t("recording"))
            : (online ? "تأكيد الحجز" : t("record"))}
        </button>
      </div>
    </>
  );
}
