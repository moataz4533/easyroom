"use client";
import { Suspense, useEffect, useState } from "react";
import { currencyWord } from "../../lib/hotel-settings";
import { useRouter, useSearchParams } from "next/navigation";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, addDays, nights, dayLabel } from "../../lib/supabase";
import { localePath, localizedName, useLocale } from "../../lib/locale";
import { isReturning, isUnreliable, summariseStays } from "../../lib/guest-history";
import {
  duplicateCount, guestToReuse, namesOnPhone, normalisePhone, pickGuest, sameName,
} from "../../lib/guest-match";
import { clashingStays, roomsOf } from "../../lib/duplicate-booking";
import {
  extraPayloads, extraRow, extrasProblem, extrasTotal, fillFromItem,
} from "../../lib/booking-extras";
import { implausibleFields } from "../../lib/guest-record";
import { DISCOUNT_KINDS, discountProblem, previewStay } from "../../lib/discount";
import { fullDate, joinList } from "../../lib/format";
import PasteMessage from "../../components/PasteMessage";
import { loadCached, provisionalAdd, provisionalList, useOffline } from "../../lib/offline";
import {
  newProvisional, roomsHeldOn, roomsWantedByDrafts, validateProvisional,
} from "../../lib/provisional";
import { useTranslations } from "next-intl";
import { MessageSquareText } from "lucide-react";
import BookingReview from "../../components/BookingReview";
import ReservationProof from "../../components/ReservationProof";

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
  const tn = useTranslations("NewBooking");
  const td = useTranslations("Discount");
  // The extras catalogue speaks for itself; its rules read from Charges.
  const tch = useTranslations("Charges");
  const { online } = useOffline();

  const presetRoom = params.get("room");
  const presetDate = ISO_DATE.test(params.get("check_in") || "") ? params.get("check_in") : null;

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [guest, setGuest] = useState(null);
  const [history, setHistory] = useState(null);
  const [searching, setSearching] = useState(false);
  const [duplicates, setDuplicates] = useState(0);
  // Everybody already recorded against this number. With a company
  // number that is a list of other people, not of this guest.
  const [onPhone, setOnPhone] = useState([]);
  // Live stays over the chosen nights, for spotting the same guest twice.
  const [staysOver, setStaysOver] = useState([]);
  const [clashOk, setClashOk] = useState(false);
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
  const [addonQuote, setAddonQuote] = useState([]);
  // The catalogue, and the lines reception is adding by hand on this booking.
  const [chargeItems, setChargeItems] = useState([]);
  const [extras, setExtras] = useState([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [completed, setCompleted] = useState(null);
  // One discount for the booking, applied to every room on it. Reception
  // quotes the discounted price on the phone, so it has to be settable
  // before the booking exists rather than corrected afterwards. A room that
  // needs its own figure gets it on the booking screen, per room.
  const [discount, setDiscount] = useState({ kind: "", value: "", note: "" });

  const n = nights(checkIn, checkOut);

  // The register is only as good as what is typed here. Said out loud and
  // never blocked: the desk still takes the booking, and a guest with no
  // papers at 2am is a real guest. What this stops is the silent version,
  // where "123" goes in and nobody sees it again until an inspection.
  const suspect = implausibleFields({ full_name: name, phone, id_number: idNumber }, locale);

  useEffect(() => {
    if (!property) return;
    supabase.from("rate_plans").select("*").eq("property_id", property.id).eq("is_active", true)
      .order("sort_order").then(({ data }) => {
        setPlans(data || []);
        setPlanId((data || []).find((p) => p.is_default)?.id || data?.[0]?.id || "");
      });
    supabase.from("accounts").select("*").eq("property_id", property.id)
      .eq("is_active", true).order("name").then(({ data }) => setAccounts(data || []));
    supabase.from("charge_items").select("*").eq("property_id", property.id)
      .eq("is_active", true).order("sort_order").then(({ data }) => setChargeItems(data || []));
  }, [property]);

  /**
   * Every stay that holds a room over these nights, fetched when the dates
   * change and not on every keystroke of the name. Who it belongs to is
   * worked out here in the browser, so the warning appears as the name is
   * being typed rather than a request later.
   */
  useEffect(() => {
    if (!property || !online || n < 1) return setStaysOver([]);
    supabase.from("bookings")
      .select("reference, status, check_in, check_out, guests(full_name, phone), room_allocations(released_at, rooms(number))")
      .eq("property_id", property.id)
      .in("status", ["confirmed", "checked_in", "inquiry"])
      .lt("check_in", checkOut).gt("check_out", checkIn)
      .then(({ data }) => setStaysOver(data || []));
  }, [property, checkIn, checkOut, n, online]);

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

  // Services attached to the rate plan are quoted by the database with the
  // same quantity function create_booking uses. The final review therefore
  // cannot drift from the charge lines that will actually be stored.
  useEffect(() => {
    const selected = Object.entries(picked).map(([room_id, occupancy]) => ({ room_id, occupancy }));
    if (!property || !planId || !selected.length || n < 1 || !online) {
      setAddonQuote([]);
      setAddonsLoading(false);
      return;
    }
    let current = true;
    setAddonsLoading(true);
    supabase.rpc("quote_rate_plan_addons", {
      p_property: property.id,
      p_rate_plan: planId,
      p_rooms: selected,
      p_check_in: checkIn,
      p_check_out: checkOut,
    }).then(({ data, error }) => {
      if (!current) return;
      setAddonsLoading(false);
      if (error) {
        setAddonQuote(null);
        return;
      }
      setAddonQuote(data || []);
    });
    return () => { current = false; };
  }, [picked, planId, property, checkIn, checkOut, n, online]);

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
      return showToast(tn("searchFailed"), true);
    }

    const found = pickGuest(matches || []);
    setDuplicates(duplicateCount(matches || []));
    setOnPhone(namesOnPhone(matches || [], phone));

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
    if (found) {
      setGuest(found); setName(found.full_name); setIdNumber(found.id_number || "");
      showToast(tn("previousGuest", { name: found.full_name }));
    } else {
      setGuest(null); setIdNumber(""); showToast(tn("newGuest"));
    }
  }

  // Names on this number that are not the one being typed.
  const othersOnPhone = onPhone.filter((other) => !sameName(other, name));

  /**
   * The same guest already booked over these nights. A warning, never a
   * refusal: two rooms for one family under one name is a real booking.
   * Ticking the box is what turns a second booking from an accident into a
   * decision.
   */
  const clashes = clashingStays(staysOver, { name, phone, checkIn, checkOut });
  useEffect(() => { setClashOk(false); }, [clashes.length, name, checkIn, checkOut]);

  const totalHeads = Object.values(picked).reduce((a, b) => a + b, 0);

  /**
   * What the guest will actually pay, discount included.
   *
   * Spread over every room-night of the selection: the quote is one number
   * and the nights behind it are not on this screen. Exact for a percentage
   * and for a named rate; a fixed sum against a night cheaper than the sum
   * is settled by the database when the booking is taken, which is why the
   * screen calls this a quote.
   */
  const priced = typeof quote === "number"
    ? previewStay(quote, n * Object.keys(picked).length, discount.kind || null, discount.value)
    : null;
  const paidAddons = Array.isArray(addonQuote)
    ? addonQuote.reduce((sum, row) => sum + (row.is_included ? 0 : Number(row.amount || 0)), 0)
    : null;
// The number at the bottom of the screen and on the review has to be what
// the guest will actually be told: rooms, the plan's paid extras, and
// whatever reception is adding on this booking.
  const reviewTotal = priced && paidAddons !== null
    ? priced.net + paidAddons + extrasTotal(extras)
    : null;

  /**
   * With no connection nothing can be held: the room is only reserved when
   * the request reaches the database. So this writes the booking down as
   * provisional and says so — it does not pretend to have confirmed it.
   */
  function recordProvisional() {
    const record = newProvisional({
      propertyId: property.id,
      guestName: name, guestPhone: phone, guestIdNumber: idNumber,
      checkIn, checkOut,
      rooms: picked,
      roomLabels: Object.fromEntries(
        Object.keys(picked).map((id) => [id, choices.find((c) => c.id === id)?.number || id])
      ),
      ratePlanId: planId || null,
      source, notes,
    });

    const problems = validateProvisional(record);
    if (problems.includes("name")) return showToast(tn("needName"), true);
    if (problems.includes("rooms")) return showToast(tn("needRoom"), true);
    if (problems.length) return showToast(tn("checkDates"), true);

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

  function openReview() {
    if (!online) return recordProvisional();
    if (!name.trim()) return showToast(tn("needName"), true);
    // The button is disabled for this too; checked again because the list
    // can change under a dialog that is already open.
    if (clashes.length && !clashOk) return showToast(tn("confirmDuplicate"), true);
    const badExtra = extrasProblem(extras);
    if (badExtra) return showToast(tch(badExtra), true);
    if (!Object.keys(picked).length) return showToast(tn("needRoom"), true);
    const badDiscount = discountProblem(discount.kind || null, discount.value);
    if (badDiscount) return showToast(td(badDiscount), true);
    if (quote === UNPRICED || quote === null || addonQuote === null || addonsLoading) {
      return showToast(tn("reviewPriceMissing"), true);
    }
    setReviewOpen(true);
  }

  async function submit() {
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
        return showToast(tn("lookupFailed"), true);
      }
      guestId = guestToReuse(onFile || [], { name, phone })?.id;
    }
    if (!guestId) {
      const { data, error } = await supabase.from("guests").insert({
        property_id: property.id, full_name: name.trim(), phone: phone.trim() || null,
        id_number: idNumber.trim() || null,
      }).select().single();
      if (error) { setBusy(false); return showToast(error.message, true); }
      guestId = data.id;
    } else {
      const { error: guestUpdateFailed } = await supabase.from("guests").update({
        full_name: name.trim(), phone: phone.trim() || null, id_number: idNumber.trim() || null,
      }).eq("id", guestId).eq("property_id", property.id);
      if (guestUpdateFailed) { setBusy(false); return showToast(guestUpdateFailed.message, true); }
    }

    const { data: booking, error } = await supabase.rpc("create_booking", {
      p_property: property.id,
      p_guest_id: guestId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_rooms: Object.entries(picked).map(([room_id, occupancy]) => ({
        room_id, occupancy,
        discount_kind: discount.kind || null,
        discount_value: discount.kind ? Number(discount.value) : null,
        discount_note: discount.kind ? discount.note.trim() || null : null,
      })),
      p_rate_plan: planId || null,
      p_account_id: accountId || null,
      p_source: source,
      p_notes: notes || null,
    });

    if (error) {
      setBusy(false);
      // The exclusion constraint fires if someone took the room first.
      return showToast(
        error.message.includes("exclusion") || error.code === "23P01"
          ? tn("justTaken")
          : error.message,
        true
      );
    }

    // One call per line, through the same function the booking sheet has
    // always used — so a line added here and a line added later are the same
    // kind of thing, and the total is recalculated by the database either way.
    for (const payload of extraPayloads(extras, booking.id)) {
      const { error: chargeFailed } = await supabase.rpc("add_booking_charge", payload);
      // The booking exists and the room is held. Saying which line did not
      // land beats unwinding a confirmed booking over a transfer.
      if (chargeFailed) showToast(tn("extraFailed", { name: payload.p_description }), true);
    }

    const { data: full, error: proofError } = await supabase.from("bookings").select(`
      id, property_id, reference, status, source, check_in, check_out, adults, children,
      total_amount, paid_amount, notes, rate_plan_id, account_id,
      guests(id, full_name, phone, id_number, nationality),
      rate_plans(id, code, name, name_en), accounts(id, name),
      room_allocations(id, occupancy, starts_on, ends_on, released_at, release_reason,
        rooms(number, room_types(name, name_en))),
      booking_charges(id, charge_item_id, description, description_en, quantity,
        unit_amount, amount, is_included, pricing_basis, voided_at)
    `).eq("id", booking.id).single();
    setBusy(false);
    setReviewOpen(false);
    if (proofError) {
      return showToast(tn("proofLoadFailed", { reference: booking.reference }), true);
    }
    setCompleted(full);
    showToast(tn("recorded", { reference: booking.reference }));
  }

  return (
    <>
      <Toast {...(toast || {})} />
      <BookingReview
        open={reviewOpen}
        draft={{
          name, phone, idNumber, checkIn, checkOut, source, notes,
          rooms: Object.entries(picked).map(([id, occupancy]) => ({
            id, occupancy, number: choices.find((room) => room.id === id)?.number,
            type: choices.find((room) => room.id === id)?.type,
          })),
        }}
        plan={plans.find((plan) => plan.id === planId)}
        account={accounts.find((account) => account.id === accountId)}
        addons={Array.isArray(addonQuote) ? addonQuote : []}
        extras={extras}
        roomSubtotal={priced?.net || 0} total={reviewTotal || 0} busy={busy}
        onClose={() => setReviewOpen(false)} onConfirm={submit}
      />
      {completed && (
        <ReservationProof property={property} booking={completed}
          allocations={completed.room_allocations || []}
          charges={completed.booking_charges || []}
          onClose={() => router.push(localePath("/", locale))}
          onCopied={() => showToast(tn("proofCopied"))}
          onCopyFailed={() => showToast(tn("proofCopyFailed"), true)} />
      )}
      <h2 style={{ marginBottom: 4 }}>{tn("title")}</h2>
      <p className="section-note">{tn("intro")}</p>

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
              <label htmlFor="phone">{tn("phone")}</label>
              <input
                id="phone" className="mono" dir="ltr" style={{ textAlign: "left" }}
                value={phone} placeholder="+2010…"
                onChange={(e) => {
                  setPhone(e.target.value); setGuest(null); setHistory(null); setOnPhone([]);
                }}
                onKeyDown={(e) => e.key === "Enter" && findGuest()}
              />
            </div>
            <button className="btn" onClick={findGuest} disabled={searching}
              style={{ alignSelf: "flex-end" }}>
              {searching ? tn("searching") : tn("search")}
            </button>
          </div>

          <div className="field">
            <label htmlFor="name">{tn("guestName")}</label>
            {/* Typing over the name the search filled in has to mean what it
                says. It used to change nothing: the booking still went to the
                guest the search had found, and the typed name was dropped. */}
            <input id="name" value={name} onChange={(e) => {
              setName(e.target.value);
              if (guest && !sameName(guest.full_name, e.target.value)) {
                setGuest(null);
                setHistory(null);
              }
            }} />
          </div>

          <div className="field">
            <label htmlFor="id-number">{tn("idNumber")}</label>
            <input id="id-number" className="mono" dir="ltr" value={idNumber}
              placeholder={tn("idNumberHint")}
              onChange={(e) => setIdNumber(e.target.value)} />
          </div>

          {guest && (
            <div className="banner ok" style={{ margin: 0 }}>
              {history && isReturning(history)
                ? tn("returning", { count: history.stays, date: dayLabel(history.lastVisit, locale) })
                : tn("seenBefore")}
              {" "}{guest.notes ? tn("guestNotes", { notes: guest.notes }) : tn("noGuestNotes")}
            </div>
          )}

          {suspect.length > 0 && (
            <div className="banner warn" style={{ margin: 0 }}>
              {tg("looksWrong", { issues: joinList(suspect.map((issue) => issue.message), locale) })}
              {" "}{tg("carryOnAnyway")}
            </div>
          )}

          {/* A company number carries many guests. Saying so out loud is the
              difference between a new row on purpose and a booking quietly
              filed under somebody else's name. */}
          {clashes.length > 0 && (
            <div className="banner warn">
              <strong>{tn("alreadyBooked", { count: clashes.length })}</strong>
              <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                {clashes.map((stay) => (
                  <li key={stay.reference} style={{ fontSize: 12 }}>
                    {tn("alreadyBookedLine", {
                      reference: stay.reference,
                      from: dayLabel(stay.check_in, locale),
                      to: dayLabel(stay.check_out, locale),
                      rooms: joinList(roomsOf(stay), locale) || tn("noRoomsYet"),
                    })}
                  </li>
                ))}
              </ul>
              <label className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }}
                  checked={clashOk} onChange={(e) => setClashOk(e.target.checked)} />
                <span style={{ fontSize: 13 }}>{tn("bookAnyway")}</span>
              </label>
            </div>
          )}

          {!guest && othersOnPhone.length > 0 && (
            <div className="banner" style={{ margin: 0 }}>
              {tn("phoneHasOthers", {
                count: othersOnPhone.length,
                names: joinList(othersOnPhone.slice(0, 3), locale),
              })}
              {name.trim() ? ` ${tn("willBeNewGuest", { name: name.trim() })}` : ""}
            </div>
          )}

          {duplicates > 0 && guest && (
            <div className="banner warn" style={{ margin: 0 }}>
              {t("duplicates", { count: duplicates })}
            </div>
          )}

          {history && isUnreliable(history) && (
            <div className="banner bad" style={{ margin: 0 }}>
              {tn("noShows", { count: history.noShows })}
            </div>
          )}

          {history && history.outstanding > 0 && (
            <div className="banner warn" style={{ margin: 0 }}>
              {tn("owes", { amount: egp(history.outstanding, locale), currency: currencyWord(locale) })}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="card">
          <div className="row">
            <div className="field grow">
              <label htmlFor="ci">{tn("checkInLabel")}</label>
              {/* dir="ltr" like every other structured field in this app.
                  Left in the page direction, a date input lays its segments
                  out right to left and the day reads as the year. */}
              <input id="ci" type="date" className="mono" dir="ltr"
                style={{ textAlign: "left" }} value={checkIn}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1));
                }} />
            </div>
            <div className="field grow">
              <label htmlFor="co">{tn("checkOutLabel")}</label>
              <input id="co" type="date" className="mono" dir="ltr"
                style={{ textAlign: "left" }} value={checkOut}
                min={addDays(checkIn, 1)}
                onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>

          {/* Said back in words, weekday included. The native picker shows
              whatever the phone's locale says — often the year first — and a
              wrong pick is caught by the day name, not by the digits. */}
          {n > 0 ? (
            <div className="banner ok" style={{ margin: "10px 0 0" }}>
              {tn("stayReads", {
                from: fullDate(checkIn, locale),
                to: fullDate(checkOut, locale),
              })}
              {" · "}{tn("nightCount", { count: n })}
            </div>
          ) : (
            <div className="banner warn" style={{ margin: "10px 0 0" }}>{tn("badDates")}</div>
          )}

          {/* How long, not which date — the way it is said on the phone.
              Sets the departure from the arrival, so the second date never
              has to be worked out in anybody's head. */}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span className="section-note" style={{ margin: 0, alignSelf: "center" }}>
              {tn("nightsQuick")}
            </span>
            {[1, 2, 3, 7].map((count) => (
              <button key={count} type="button"
                className={`btn sm${n === count ? " primary" : ""}`}
                onClick={() => setCheckOut(addDays(checkIn, count))}>
                {tn("nightCount", { count })}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>{tn("freeRooms")}</h2>
        <p className="section-note">
          {online ? tn("pickRooms") : t("availabilityUnknown")}
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
            {online ? tn("noneFree") : t("noSavedRooms")}
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
                          <option key={o} value={o}>{tn("paxOption", { count: o })}</option>
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
            <label htmlFor="plan">{tn("ratePlan")}</label>
            <select id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{localizedName(p, locale)}</option>)}
            </select>
          </div>

          {accounts.length > 0 && (
            <div className="field">
              <label htmlFor="acc">{tn("company")}</label>
              <select id="acc" value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  const a = accounts.find((x) => x.id === e.target.value);
                  if (a?.rate_plan_id) setPlanId(a.rate_plan_id);
                }}>
                <option value="">{tn("none")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="src">{tn("source")}</label>
            <select id="src" value={source} onChange={(e) => setSource(e.target.value)}>
              {["whatsapp", "phone", "walk_in", "referral", "other"].map((key) => (
                <option key={key} value={key}>{tn(`source_${key}`)}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="notes">{tn("notes")}</label>
            <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={tn("notesPlaceholder")} />
          </div>

          {/* The plan's own extras already come down with the price. These
              are the ones the guest asks for while reception's hands are
              still on the screen — a transfer, a late checkout — which used
              to mean confirming the booking and finding it again. */}
          {online && (
            <div className="stack">
              <div className="spread">
                <strong style={{ fontSize: 13 }}>{tn("extrasTitle")}</strong>
                {extrasTotal(extras) > 0 && (
                  <span className="pill">
                    {`${egp(extrasTotal(extras), locale)} ${currencyWord(locale)}`}
                  </span>
                )}
              </div>

              {extras.map((row, index) => (
                <div key={row.key} className="extra-line">
                  <div className="field">
                    <label htmlFor={`ex-item-${row.key}`}>{tch("item")}</label>
                    <select id={`ex-item-${row.key}`} value={row.charge_item_id}
                      onChange={(e) => setExtras((rows) => rows.map((r, i) => i === index
                        ? fillFromItem(r, chargeItems.find((item) => item.id === e.target.value))
                        : r))}>
                      <option value="">{tch("freeLine")}</option>
                      {chargeItems.map((item) => (
                        <option key={item.id} value={item.id}>{localizedName(item, locale)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`ex-desc-${row.key}`}>{tch("description")}</label>
                    <input id={`ex-desc-${row.key}`} value={row.description}
                      placeholder={tch("descriptionHint")}
                      onChange={(e) => setExtras((rows) => rows.map((r, i) =>
                        i === index ? { ...r, description: e.target.value } : r))} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ex-qty-${row.key}`}>{tch("quantity")}</label>
                    <input id={`ex-qty-${row.key}`} className="mono" type="number" min="1"
                      value={row.quantity}
                      onChange={(e) => setExtras((rows) => rows.map((r, i) =>
                        i === index ? { ...r, quantity: e.target.value } : r))} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ex-amt-${row.key}`}>{tch("unitAmount")}</label>
                    <input id={`ex-amt-${row.key}`} className="mono" type="number" min="0"
                      value={row.unit_amount}
                      onChange={(e) => setExtras((rows) => rows.map((r, i) =>
                        i === index ? { ...r, unit_amount: e.target.value } : r))} />
                  </div>
                  <button className="btn sm danger remove"
                    aria-label={tn("removeExtra")}
                    onClick={() => setExtras((rows) => rows.filter((_, i) => i !== index))}>
                    ×
                  </button>
                </div>
              ))}

              <button className="btn ghost" onClick={() => setExtras((rows) => [...rows, extraRow()])}>
                {tn("addExtra")}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Offline there is no price to discount — the booking is written down
          as provisional and priced when it reaches the database. */}
      {online && (
        <section className="section">
          <div className="card stack">
            <div className="field">
              <label htmlFor="discount-kind">{td("bookingTitle")}</label>
              <select id="discount-kind" value={discount.kind}
                onChange={(e) => setDiscount((d) => ({ ...d, kind: e.target.value }))}>
                <option value="">{td("kind_none")}</option>
                {DISCOUNT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{td(`kind_${kind}`)}</option>
                ))}
              </select>
            </div>

            {discount.kind && (
              <>
                <div className="row">
                  <div className="field grow">
                    <label htmlFor="discount-value">{td(`value_${discount.kind}`)}</label>
                    <input id="discount-value" type="number" min="0" className="mono"
                      max={discount.kind === "percent" ? 100 : undefined}
                      value={discount.value}
                      onChange={(e) => setDiscount((d) => ({ ...d, value: e.target.value }))} />
                  </div>
                  <div className="field grow">
                    <label htmlFor="discount-note">{td("note")}</label>
                    <input id="discount-note" value={discount.note} placeholder={td("noteHint")}
                      onChange={(e) => setDiscount((d) => ({ ...d, note: e.target.value }))} />
                  </div>
                </div>
                <p className="section-note" style={{ margin: 0 }}>{td("appliesToAll")}</p>
              </>
            )}
          </div>
        </section>
      )}

      <div className="card" style={{ position: "sticky", bottom: 84, background: "var(--deep)",
        color: "#fff", borderColor: "var(--deep)" }}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, opacity: .8 }}>
              {tn("summary", { rooms: Object.keys(picked).length, heads: totalHeads, nights: n })}
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
              {reviewTotal !== null ? `${egp(reviewTotal, locale)} ${currencyWord(locale)}` : "—"}
            </div>
            {/* The price before the discount stays visible: reception says
                both numbers out loud on the phone. */}
            {priced && priced.discount > 0 && (
              <div style={{ fontSize: 12, opacity: .8 }}>
                <span style={{ textDecoration: "line-through" }}>
                  {egp(priced.list, locale)} {currencyWord(locale)}
                </span>
                {" · "}
                {td("saved", { amount: egp(priced.discount, locale), currency: currencyWord(locale) })}
              </div>
            )}
          </div>
        </div>
        {quote === UNPRICED && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            {tn("unpriced")}
          </div>
        )}
        {online && quote === 0 && Object.keys(picked).length > 0 && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            {tn("zeroPrice")}
          </div>
        )}
        {!online && (
          <div style={{ fontSize: 12, marginBottom: 8, color: "#F5D08A" }}>
            {t("noPrice")}
          </div>
        )}
        <button className="btn wide"
          disabled={busy || addonsLoading || !Object.keys(picked).length || n < 1
            || (clashes.length > 0 && !clashOk)}
          onClick={openReview}
          style={{ background: "#fff", color: "var(--deep)", borderColor: "#fff", fontWeight: 600 }}>
          {busy
            ? (online ? tn("recording") : t("recording"))
            : (online ? tn("review") : t("record"))}
        </button>
      </div>
    </>
  );
}
