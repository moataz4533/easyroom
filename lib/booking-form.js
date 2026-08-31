import { countNights } from "./format";

/**
 * The hotel's own booking confirmation, printed for a guest to carry.
 *
 * The desk was writing one by hand on a paper headed «استمارة حجز». This is
 * that paper, generated — from a real booking, or typed in by hand when
 * there is no booking to generate it from.
 *
 * Two things about it are deliberate and should survive edits:
 *
 * 1. **No money.** The paper is handed to people outside the hotel, read,
 *    and passed back; what the guest paid is not their business. A
 *    confirmation without rates is completely ordinary, so nothing about
 *    the omission shows. `reservationProofModel` is the one that carries
 *    the money, and no field here should ever grow into it.
 *
 * 2. **One language at a time, the desk's choice.** An Egyptian guest gets
 *    Arabic, a foreign guest gets English. Printing both at once was the
 *    first attempt, and it read as a form to be filled in rather than as a
 *    hotel's own stationery.
 *
 * The printed words are a fixed table here rather than message-catalogue
 * keys, the same decision `lib/reservation-proof.js` makes: the document's
 * language is chosen on the panel and is independent of the language the
 * staff member happens to be using the app in.
 */
export const PASS_LOCALES = ["en", "ar"];

const WORDS = {
  en: {
    title: "Booking Confirmation",
    reference: "Confirmation no.",
    issuedOn: "Issued",
    guestSection: "Guest details",
    staySection: "Reservation details",
    guest: "Guest name",
    idNumber: "Passport / ID no.",
    nationality: "Nationality",
    phone: "Telephone",
    checkIn: "Arrival",
    checkOut: "Departure",
    nights: "Nights",
    party: "Guests",
    rooms: "Accommodation",
    statement: "This confirms a reservation held in the name above for the dates shown. "
      + "We look forward to welcoming you.",
    stamp: "Authorised signature",
    missing: "Not recorded",
    night: "night",
    nights_other: "nights",
    guestWord: "guest",
    guests_other: "guests",
  },
  ar: {
    title: "تأكيد حجز",
    reference: "رقم التأكيد",
    issuedOn: "تاريخ الإصدار",
    guestSection: "بيانات النزيل",
    staySection: "بيانات الحجز",
    guest: "الاسم",
    idNumber: "الرقم القومي / الجواز",
    nationality: "الجنسية",
    phone: "التليفون",
    checkIn: "تاريخ الوصول",
    checkOut: "تاريخ المغادرة",
    nights: "عدد الليالي",
    party: "عدد الأفراد",
    rooms: "الإقامة",
    statement: "يؤكد هذا المستند وجود حجز باسم النزيل المذكور أعلاه في التواريخ الموضّحة، "
      + "ويسعدنا استقبالكم.",
    stamp: "توقيع معتمد",
    missing: "غير مسجَّل",
    night: "ليلة",
    nights_other: "ليالٍ",
    guestWord: "فرد",
    guests_other: "أفراد",
  },
};

export function passWords(locale = "en") {
  return WORDS[locale] || WORDS.en;
}

/** Grouped the way a hotel voucher groups them: who, then when. */
export const PASS_SECTIONS = [
  { key: "guestSection", fields: ["guest", "idNumber", "nationality", "phone"] },
  { key: "staySection", fields: ["checkIn", "checkOut", "nights", "party", "rooms"] },
];

export const PASS_FIELDS = PASS_SECTIONS.flatMap((section) => section.fields);

/**
 * "12 August 2026", never "12/08/2026". A slashed date is read day-first in
 * Egypt and month-first by half the passports that walk through the door,
 * and a wrong reading here is a guest turned away at a barrier. The month
 * spelled out cannot be read two ways.
 *
 * Western digits in Arabic too (`-u-nu-latn`): the default `ar-EG` prints
 * ٢٠٢٦, which a foreign guest holding the same paper cannot read at all.
 */
const DATE_TAGS = { en: "en-GB", ar: "ar-EG-u-nu-latn" };

export function passDate(iso, locale = "en") {
  if (!iso) return "";
  const day = String(iso).slice(0, 10);
  const at = new Date(`${day}T00:00:00`);
  if (Number.isNaN(at.getTime())) return String(iso);
  return at.toLocaleDateString(DATE_TAGS[locale] || DATE_TAGS.en, {
    day: "numeric", month: "long", year: "numeric",
  });
}

function localName(value, locale) {
  if (!value) return "";
  return locale === "en"
    ? (value.name_en || value.name || "")
    : (value.name || value.name_en || "");
}

function hotelHead(property) {
  const settings = property?.settings || {};
  return {
    // The letterhead carries the hotel's English name beside the logo, in
    // both languages of the document — that is the mark a hotel puts on its
    // paper, and the one every reader of this document can read. The Arabic
    // name is not repeated underneath it.
    brand: property?.name_en || property?.name || "",
    name: property?.name || property?.name_en || "",
    nameEn: property?.name_en || property?.name || "",
    logo: property?.logo_url || "",
    address: settings.address || "",
    phone: settings.phone || settings.whatsapp || "",
    email: settings.email || "",
  };
}

/**
 * An empty hand-typed form, for the two cases a booking row cannot cover:
 * somebody who has only provisionally asked to come and will settle it when
 * they arrive, and somebody whose stay is already over and who wants the
 * paper afterwards.
 *
 * **Nothing typed here is written to the database.** A printed paper is not
 * a booking: it holds no room, reaches no report, and cannot double-book
 * anything. The screen says so out loud, because a form that looks like a
 * booking screen and quietly is not would be worse than no form at all.
 */
export function manualForm(defaults = {}) {
  return {
    reference: "", guest: "", idNumber: "", nationality: "", phone: "",
    checkIn: "", checkOut: "", party: "1", rooms: "",
    ...defaults,
  };
}

export function manualProblem(form) {
  if (!String(form?.guest || "").trim()) return "needGuest";
  if (!form?.checkIn || !form?.checkOut) return "needDates";
  if (String(form.checkOut) <= String(form.checkIn)) return "checkOutAfterCheckIn";
  return null;
}

export function manualModel({ property, form, issuedOn = null }) {
  const party = Math.max(Number(form?.party) || 0, 1);
  const rooms = String(form?.rooms || "").trim();
  return {
    reference: String(form?.reference || "").trim(),
    issuedOn: issuedOn || null,
    guest: String(form?.guest || "").trim(),
    idNumber: String(form?.idNumber || "").trim(),
    nationality: String(form?.nationality || "").trim(),
    phone: String(form?.phone || "").trim(),
    checkIn: form?.checkIn || null,
    checkOut: form?.checkOut || null,
    nights: countNights(form?.checkIn, form?.checkOut),
    adults: party,
    children: 0,
    party,
    rooms: [],
    // Typed by hand and printed as typed — there is no room type to look
    // up, and the desk knows better than the app what to call it.
    roomsText: rooms,
    roomCount: rooms ? 1 : 0,
    hotel: hotelHead(property),
  };
}

export function bookingFormModel({ property, booking, allocations = [], issuedOn = null }) {
  const live = allocations.filter((row) => !row.release_reason && !row.released_at);
  const rooms = live.map((row) => ({
    number: row.rooms?.number || row.number || "",
    typeAr: localName(row.rooms?.room_types || row.room_types, "ar"),
    typeEn: localName(row.rooms?.room_types || row.room_types, "en"),
  }));
  const adults = Number(booking?.adults) || 0;
  const children = Number(booking?.children) || 0;
  const occupancy = live.reduce((sum, row) => sum + (Number(row.occupancy) || 0), 0);

  return {
    reference: booking?.reference || "",
    issuedOn: issuedOn || null,
    guest: booking?.guests?.full_name || "",
    idNumber: booking?.guests?.id_number || "",
    nationality: booking?.guests?.nationality || "",
    phone: booking?.guests?.phone || "",
    checkIn: booking?.check_in || null,
    checkOut: booking?.check_out || null,
    nights: countNights(booking?.check_in, booking?.check_out),
    adults,
    children,
    // The occupancy on the rooms is what the hotel actually blocked; the
    // adults/children on the booking is what reception typed. When they
    // disagree the larger one is the safer number to print, because a
    // voucher listing fewer people than the car holds is the one that
    // starts an argument at a barrier.
    party: Math.max(adults + children, occupancy, 1),
    rooms,
    roomsText: "",
    roomCount: rooms.length,
    hotel: hotelHead(property),
  };
}

/**
 * "4 — Triple room", the way a voucher names what was booked. Arabic puts
 * the room type first so the line reads outwards from the right instead of
 * starting on a bare digit.
 */
export function roomsLine(model, locale = "en") {
  if (model.roomsText) return model.roomsText;
  return model.rooms
    .map((room) => {
      const type = locale === "en" ? room.typeEn : room.typeAr;
      const parts = locale === "en" ? [room.number, type] : [type, room.number];
      return parts.filter(Boolean).join(" — ");
    })
    .join(" · ");
}

export function nightsLine(count, locale = "en") {
  const w = passWords(locale);
  return `${count} ${count === 1 ? w.night : w.nights_other}`;
}

export function partyLine(count, locale = "en") {
  const w = passWords(locale);
  return `${count} ${count === 1 ? w.guestWord : w.guests_other}`;
}

/** Every printed value for one field, in one language. */
export function passValues(model, locale = "en") {
  return {
    guest: model.guest,
    idNumber: model.idNumber,
    nationality: model.nationality,
    phone: model.phone,
    checkIn: passDate(model.checkIn, locale),
    checkOut: passDate(model.checkOut, locale),
    nights: model.nights ? nightsLine(model.nights, locale) : "",
    party: model.party ? partyLine(model.party, locale) : "",
    rooms: roomsLine(model, locale),
  };
}

/**
 * What is missing that the paper needs. Reception sees this *before*
 * printing, because a confirmation with a blank passport number is worse
 * than none — the guest finds out about the gap when they are already on
 * the road, hours from here.
 */
export function passGaps(model) {
  const gaps = [];
  if (!model.idNumber) gaps.push("idNumber");
  if (!model.hotel.phone) gaps.push("hotelPhone");
  if (!model.hotel.address) gaps.push("hotelAddress");
  return gaps;
}

/**
 * A stay real enough to print a confirmation for. A finished stay counts:
 * guests ask for the paper after they get home as often as before they set
 * off. A cancelled one does not — that paper would be a lie.
 */
export function passableBooking(booking) {
  if (!booking) return false;
  return ["confirmed", "checked_in", "checked_out"].includes(booking.status);
}

/** Split the list the way the desk thinks about it: still coming, or over. */
export function isCurrentStay(booking, todayIso) {
  if (!booking?.check_out) return false;
  return String(booking.check_out) >= String(todayIso);
}

export function passText(model, locale = "en") {
  const w = passWords(locale);
  const values = passValues(model, locale);
  const shown = (key) => values[key] || w.missing;
  const lines = [`*${model.hotel.brand}*`];
  // A hand-typed form may have no reference at all, and a heading ending in
  // a dangling dash is how that used to read.
  lines.push(model.reference ? `${w.title} — ${model.reference}` : w.title, "");
  lines.push(
    `${w.guest}: ${shown("guest")}`,
    `${w.idNumber}: ${shown("idNumber")}`,
    `${w.phone}: ${shown("phone")}`,
    `${w.checkIn}: ${shown("checkIn")}`,
    `${w.checkOut}: ${shown("checkOut")}`,
    `${w.nights}: ${shown("nights")}`,
    `${w.party}: ${shown("party")}`,
    `${w.rooms}: ${shown("rooms")}`,
    "",
    w.statement,
  );
  const contact = [model.hotel.address, model.hotel.phone].filter(Boolean).join(" · ");
  if (contact) lines.push("", contact);
  return lines.join("\n");
}

export function bookingFormText({
  property, booking, allocations, issuedOn = null, locale = "en",
}) {
  return passText(bookingFormModel({ property, booking, allocations, issuedOn }), locale);
}
