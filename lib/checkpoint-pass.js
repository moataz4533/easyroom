import { countNights } from "./format";

/**
 * A checkpoint pass is not a bill and not a confirmation. It answers one
 * question for a soldier standing on the Sharm road at midnight: is this
 * car really going to a hotel that is expecting it?
 *
 * Two consequences shape everything below.
 *
 * 1. **No money.** The document is handed to strangers, read at a window,
 *    and passed back. What the guest paid is nobody's business at a
 *    checkpoint, and printing it invites a conversation the guest should
 *    never have to have. `reservationProofModel` carries the money; this
 *    one deliberately does not, and no field here should ever grow into it.
 *
 * 2. **Both languages at once, always.** The officer reads Arabic; the
 *    guest may hold a German passport. A language switch would leave one
 *    of the two unable to read the paper in their hand, so the labels are
 *    a fixed bilingual table rather than a locale lookup — the same
 *    decision `lib/reservation-proof.js` makes for its message text.
 */
export const PASS_WORDS = {
  title:      { ar: "إثبات حجز فندقي", en: "Hotel Reservation Certificate" },
  purpose:    { ar: "صادر لتيسير المرور", en: "Issued to facilitate passage" },
  reference:  { ar: "رقم الحجز", en: "Booking reference" },
  issuedOn:   { ar: "تاريخ الإصدار", en: "Issued on" },
  guest:      { ar: "اسم النزيل", en: "Guest name" },
  idNumber:   { ar: "الرقم القومي / الجواز", en: "National ID / Passport" },
  nationality:{ ar: "الجنسية", en: "Nationality" },
  phone:      { ar: "رقم الهاتف", en: "Phone" },
  checkIn:    { ar: "تاريخ الوصول", en: "Arrival" },
  checkOut:   { ar: "تاريخ المغادرة", en: "Departure" },
  nights:     { ar: "عدد الليالي", en: "Nights" },
  party:      { ar: "عدد الأفراد", en: "Party size" },
  rooms:      { ar: "الغرف", en: "Rooms" },
  verify:     { ar: "للتحقق من الحجز اتصل بالفندق", en: "To verify this booking, call the hotel" },
  stamp:      { ar: "ختم وتوقيع إدارة الفندق", en: "Hotel stamp and signature" },
  noMoney:    { ar: "هذا المستند لا يتضمن أي بيانات مالية.", en: "This document carries no financial information." },
  missing:    { ar: "غير مسجَّل", en: "Not recorded" },
};

/** The fields a checkpoint reads, in the order it reads them. */
export const PASS_FIELDS = [
  "guest", "idNumber", "nationality", "phone",
  "checkIn", "checkOut", "nights", "party", "rooms",
];

/**
 * Dates on this document are `DD / MM / YYYY` in Western digits and nothing
 * else. A checkpoint reads it in a second under a torch; a localised
 * "١٢ أغسطس" or "12 Aug" is one more thing to misread, and their own paper
 * form already uses this exact form.
 */
export function passDate(iso) {
  if (!iso) return "";
  const [year, month, day] = String(iso).split("-");
  if (!year || !month || !day) return String(iso);
  return `${day} / ${month} / ${year}`;
}

function localName(value, locale) {
  if (!value) return "";
  return locale === "en"
    ? (value.name_en || value.name || "")
    : (value.name || value.name_en || "");
}

export function passStatement(hotelName, guestName, { locale = "ar" } = {}) {
  if (locale === "en") {
    return `The management of ${hotelName || "the hotel"} certifies that `
      + `${guestName || "the guest named above"} holds a confirmed reservation `
      + `for the period stated above.`;
  }
  return `تشهد إدارة ${hotelName || "الفندق"} بأن `
    + `${guestName || "النزيل المذكور أعلاه"} لديه حجز مؤكد بالفندق `
    + `خلال الفترة الموضّحة أعلاه.`;
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
    // disagree the larger one is the safer number to hand a checkpoint,
    // because a pass that lists fewer people than the car holds is the
    // one that causes the argument.
    party: Math.max(adults + children, occupancy, 1),
    rooms,
    roomCount: rooms.length,
    hotel: {
      name: property?.name || property?.name_en || "",
      nameEn: property?.name_en || property?.name || "",
      logo: property?.logo_url || "",
      address: settings.address || "",
      phone: settings.phone || settings.whatsapp || "",
    },
  };
}

/**
 * What is missing that the checkpoint actually needs. Reception sees this
 * *before* printing, because a pass with a blank ID number is worse than
 * no pass — the guest finds out at the barrier, four hours from here.
 */
export function passGaps(model) {
  const gaps = [];
  if (!model.idNumber) gaps.push("idNumber");
  if (!model.hotel.phone) gaps.push("hotelPhone");
  if (!model.hotel.address) gaps.push("hotelAddress");
  return gaps;
}

/** Only a live, forward-looking stay is worth a pass. */
export function passableBooking(booking, todayIso) {
  if (!booking) return false;
  if (!["confirmed", "checked_in"].includes(booking.status)) return false;
  return !todayIso || String(booking.check_out) >= String(todayIso);
}

export function buildCheckpointPassText({ property, booking, allocations, issuedOn = null }) {
  const model = checkpointPassModel({ property, booking, allocations, issuedOn });
  const w = (key) => `${PASS_WORDS[key].ar} / ${PASS_WORDS[key].en}`;
  const value = (raw) => (raw === "" || raw === null || raw === undefined
    ? `${PASS_WORDS.missing.ar} / ${PASS_WORDS.missing.en}`
    : String(raw));
  const roomLine = model.rooms.map((room) => [room.number, room.typeAr].filter(Boolean).join(" ")).join(" · ");
  const lines = [
    `*${model.hotel.name}*`,
    `*${w("title")}* — ${model.reference}`,
    "",
    `${w("guest")}: ${value(model.guest)}`,
    `${w("idNumber")}: ${value(model.idNumber)}`,
    `${w("phone")}: ${value(model.phone)}`,
    `${w("checkIn")}: ${value(passDate(model.checkIn))}`,
    `${w("checkOut")}: ${value(passDate(model.checkOut))}`,
    `${w("nights")}: ${model.nights}`,
    `${w("party")}: ${model.party}`,
    `${w("rooms")}: ${value(roomLine)}`,
    "",
    passStatement(model.hotel.name, model.guest, { locale: "ar" }),
    passStatement(model.hotel.nameEn, model.guest, { locale: "en" }),
  ];
  if (model.hotel.phone) lines.push("", `${w("verify")}: ${model.hotel.phone}`);
  lines.push("", `${PASS_WORDS.noMoney.ar} / ${PASS_WORDS.noMoney.en}`);
  return lines.join("\n");
}
