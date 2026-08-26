import { countNights, formatDate, formatNumber } from "./format";
import { labelsFor } from "./guest-locales";
import { currencyWord } from "./hotel-settings";

const WORDS = {
  ar: {
    title: "إثبات حجز", reference: "رقم الحجز", guest: "اسم النزيل",
    id: "رقم الجواز / الرقم القومي", phone: "الهاتف", stay: "الإقامة",
    nights: "عدد الليالي", rooms: "الغرف", guests: "عدد الأفراد",
    type: "نوع الحجز", source: "مصدر الحجز", included: "الخدمات المشمولة",
    extras: "الإضافات المدفوعة", roomPrice: "سعر الإقامة", total: "الإجمالي",
    notes: "ملاحظات", currency: "ج", none: "لا يوجد",
  },
  en: {
    title: "Reservation proof", reference: "Booking reference", guest: "Guest",
    id: "Passport / national ID", phone: "Phone", stay: "Stay",
    nights: "Nights", rooms: "Rooms", guests: "Guests",
    type: "Booking type", source: "Source", included: "Included services",
    extras: "Paid extras", roomPrice: "Accommodation", total: "Total",
    notes: "Notes", currency: "EGP", none: "None",
  },
  ru: {
    title: "Подтверждение брони", reference: "Номер брони", guest: "Гость",
    id: "Паспорт / удостоверение", phone: "Телефон", stay: "Проживание",
    nights: "Ночей", rooms: "Номера", guests: "Гостей",
    type: "Тип брони", source: "Источник", included: "Включённые услуги",
    extras: "Платные услуги", roomPrice: "Проживание", total: "Итого",
    notes: "Примечания", currency: "EGP", none: "Нет",
  },
  de: {
    title: "Buchungsnachweis", reference: "Buchungsnummer", guest: "Gast",
    id: "Reisepass / Ausweis", phone: "Telefon", stay: "Aufenthalt",
    nights: "Nächte", rooms: "Zimmer", guests: "Gäste",
    type: "Buchungsart", source: "Quelle", included: "Inbegriffene Leistungen",
    extras: "Kostenpflichtige Extras", roomPrice: "Unterkunft", total: "Gesamt",
    notes: "Anmerkungen", currency: "EGP", none: "Keine",
  },
  it: {
    title: "Conferma di prenotazione", reference: "Numero prenotazione", guest: "Ospite",
    id: "Passaporto / documento", phone: "Telefono", stay: "Soggiorno",
    nights: "Notti", rooms: "Camere", guests: "Ospiti",
    type: "Tipo di prenotazione", source: "Origine", included: "Servizi inclusi",
    extras: "Extra a pagamento", roomPrice: "Alloggio", total: "Totale",
    notes: "Note", currency: "EGP", none: "Nessuno",
  },
};

function nameOf(value, locale) {
  if (!value) return "";
  return locale === "ar"
    ? (value.name || value.name_en || "")
    : (value.name_en || value.name || "");
}

export function reservationProofModel({ booking, allocations = [], charges = [], locale = "ar" }) {
  // Check-out frees the room but keeps release_reason null; cancellation sets
  // a reason. Proofs for completed stays therefore keep their real rooms and
  // omit only allocations that were actually taken off the booking.
  const live = allocations.filter((row) => !row.release_reason);
  const activeCharges = charges.filter((row) => !row.voided_at);
  const included = activeCharges.filter((row) => row.is_included);
  const paidExtras = activeCharges.filter((row) => !row.is_included);
  const extrasTotal = paidExtras.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const total = Number(booking?.total_amount) || 0;
  const guestCount = live.reduce((sum, row) => sum + (Number(row.occupancy) || 0), 0)
    || Number(booking?.adults) || 0;
  const rooms = live.map((row) => ({
    number: row.rooms?.number || row.number || "",
    type: nameOf(row.rooms?.room_types || row.room_types, locale),
    occupancy: Number(row.occupancy) || 0,
  }));

  return {
    reference: booking?.reference || "",
    guest: booking?.guests?.full_name || "",
    idNumber: booking?.guests?.id_number || "",
    phone: booking?.guests?.phone || "",
    checkIn: booking?.check_in,
    checkOut: booking?.check_out,
    nights: countNights(booking?.check_in, booking?.check_out),
    guestCount,
    rooms,
    plan: nameOf(booking?.rate_plans, locale) || booking?.rate_plan_name || "",
    planCode: booking?.rate_plans?.code || booking?.rate_plan_code || "",
    company: booking?.accounts?.name || booking?.account_name || "",
    source: booking?.source || "",
    notes: booking?.notes || "",
    included: included.map((row) => ({
      name: locale === "ar" ? row.description : (row.description_en || row.description),
      quantity: Number(row.quantity) || 0,
      basis: row.pricing_basis,
    })),
    paidExtras: paidExtras.map((row) => ({
      name: locale === "ar" ? row.description : (row.description_en || row.description),
      quantity: Number(row.quantity) || 0,
      unitAmount: Number(row.unit_amount) || 0,
      amount: Number(row.amount) || 0,
      basis: row.pricing_basis,
    })),
    roomSubtotal: Math.max(total - extrasTotal, 0),
    extrasTotal,
    total,
  };
}

export function buildReservationProofText({ property, booking, allocations, charges, locale = "ar", sourceLabel }) {
  const words = labelsFor(WORDS, locale);
  const model = reservationProofModel({ booking, allocations, charges, locale });
  const hotel = locale === "ar"
    ? (property?.name || property?.name_en || "")
    : (property?.name_en || property?.name || "");
  const money = (value) => `${formatNumber(value, locale)} ${currencyWord(locale)}`;
  const lines = [
    `*${hotel}*`,
    `*${words.title}* — ${model.reference}`,
    "",
    `${words.guest}: ${model.guest}`,
  ];
  if (model.idNumber) lines.push(`${words.id}: ${model.idNumber}`);
  if (model.phone) lines.push(`${words.phone}: ${model.phone}`);
  lines.push(
    `${words.stay}: ${formatDate(model.checkIn, locale)} — ${formatDate(model.checkOut, locale)}`,
    `${words.nights}: ${formatNumber(model.nights, locale)} · ${words.guests}: ${formatNumber(model.guestCount, locale)}`,
    `${words.rooms}: ${model.rooms.map((room) => [room.number, room.type].filter(Boolean).join(" — ")).join(" / ")}`,
  );
  const type = [model.plan, model.planCode && `(${model.planCode})`, model.company].filter(Boolean).join(" · ");
  if (type) lines.push(`${words.type}: ${type}`);
  if (sourceLabel || model.source) lines.push(`${words.source}: ${sourceLabel || model.source}`);
  if (model.included.length) {
    lines.push("", `${words.included}:`);
    model.included.forEach((item) => lines.push(`• ${item.name} × ${formatNumber(item.quantity, locale)}`));
  }
  if (model.paidExtras.length) {
    lines.push("", `${words.extras}:`);
    model.paidExtras.forEach((item) => lines.push(`• ${item.name} × ${formatNumber(item.quantity, locale)} — ${money(item.amount)}`));
  }
  lines.push(
    "",
    `${words.roomPrice}: ${money(model.roomSubtotal)}`,
    `${words.total}: ${money(model.total)}`,
  );
  if (model.notes) lines.push("", `${words.notes}: ${model.notes}`);
  return lines.join("\n");
}
