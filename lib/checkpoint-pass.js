import { countNights } from "./format";

/**
 * The document the desk hands a guest before they drive down to Dahab.
 *
 * It exists because guests are stopped at checkpoints the whole way through
 * South Sinai and need to show where they are going — but it must not
 * *look* like it was made for that. A paper headed "issued to facilitate
 * passage" reads as something the guest had to go and obtain. So this is an
 * ordinary hotel booking confirmation, the same voucher any chain prints,
 * and it happens to answer the question at the barrier.
 *
 * Two things are still deliberate:
 *
 * 1. **No money.** The paper is handed to strangers, read, and passed back;
 *    what the guest paid is nobody's business there. A voucher without
 *    rates is completely ordinary, so nothing about the omission shows.
 *    `reservationProofModel` is the one that carries the money, and no
 *    field here should ever grow into it.
 *
 * 2. **One language at a time, the desk's choice.** An Egyptian guest gets
 *    Arabic, a foreign guest gets English. Printing both at once was the
 *    first attempt and it looked like a form, not like a hotel's paper.
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

export function checkpointPassModel({ property, booking, allocations = [], issuedOn = null }) {
  const live = allocations.filter((row) => !row.release_reason && !row.released_at);
  const rooms = live.map((row) => ({
    number: row.rooms?.number || row.number || "",
    typeAr: localName(row.rooms?.room_types || row.room_types, "ar"),
    typeEn: localName(row.rooms?.room_types || row.room_types, "en"),
  }));
  const adults = Number(booking?.adults) || 0;
  const children = Number(booking?.children) || 0;
  const occupancy = live.reduce((sum, row) => sum + (Number(row.occupancy) || 0), 0);
  const settings = property?.settings || {};

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
    roomCount: rooms.length,
    hotel: {
      // The letterhead carries the hotel's English name beside the logo,
      // in both languages of the document — that is the mark a hotel puts
      // on its paper, and it is the one a checkpoint and a foreign guest
      // can both read. The Arabic name is not repeated underneath it.
      brand: property?.name_en || property?.name || "",
      name: property?.name || property?.name_en || "",
      nameEn: property?.name_en || property?.name || "",
      logo: property?.logo_url || "",
      address: settings.address || "",
      phone: settings.phone || settings.whatsapp || "",
      email: settings.email || "",
    },
  };
}

/**
 * "4 — Triple room", the way a voucher names what was booked. Arabic puts
 * the room type first so the line reads outwards from the right instead of
 * starting on a bare digit.
 */
export function roomsLine(model, locale = "en") {
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
 * printing, because a voucher with a blank passport number is worse than no
 * voucher — the guest finds out at the barrier, four hours from here.
 */
export function passGaps(model) {
  const gaps = [];
  if (!model.idNumber) gaps.push("idNumber");
  if (!model.hotel.phone) gaps.push("hotelPhone");
  if (!model.hotel.address) gaps.push("hotelAddress");
  return gaps;
}

/** Only a live, forward-looking stay is worth a confirmation. */
export function passableBooking(booking, todayIso) {
  if (!booking) return false;
  if (!["confirmed", "checked_in"].includes(booking.status)) return false;
  return !todayIso || String(booking.check_out) >= String(todayIso);
}

export function buildCheckpointPassText({
  property, booking, allocations, issuedOn = null, locale = "en",
}) {
  const model = checkpointPassModel({ property, booking, allocations, issuedOn });
  const w = passWords(locale);
  const values = passValues(model, locale);
  const shown = (key) => values[key] || w.missing;
  const lines = [
    `*${model.hotel.brand}*`,
    `${w.title} — ${model.reference}`,
    "",
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
  ];
  const contact = [model.hotel.address, model.hotel.phone].filter(Boolean).join(" · ");
  if (contact) lines.push("", contact);
  return lines.join("\n");
}
