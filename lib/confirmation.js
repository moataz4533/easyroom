import { LOCALE_TAGS, formatDate, formatNumber, countNights } from "./format";
import { labelsFor } from "./guest-locales";
import { currencyWord } from "./hotel-settings";
import { chargesTotal } from "./charges";

/**
 * The WhatsApp confirmation message.
 *
 * Reception writes this by hand several times a day, which is how dates and
 * balances end up wrong. Built here as plain text — no React, no network —
 * so it can be tested, and so the staff can still edit it before sending.
 *
 * The guest's language is not always the hotel's, so the message is built
 * for whichever language is asked for, independent of the app's interface.
 */

const LABELS = {
  ar: {
    confirmation: "تأكيد حجز",
    guest: "الاسم",
    checkIn: "الدخول",
    checkOut: "الخروج",
    from: "من الساعة",
    until: "قبل الساعة",
    nights: (n) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتين" : `${formatNumber(n, "ar")} ليالي`),
    rooms: (n) => (n === 1 ? "الغرفة" : "الغرف"),
    guests: (n) => (n === 1 ? "فرد واحد" : n === 2 ? "فردين" : `${formatNumber(n, "ar")} أفراد`),
    rooms_line: "الغرف",
    extras: "الإضافات",
    total: "الإجمالي",
    paid: "المدفوع",
    owed: "المتبقي",
    settled: "الحساب مدفوع بالكامل",
    policy: "سياسة الإلغاء",
    address: "العنوان",
    thanks: "في انتظارك، وتحت أمرك لأي استفسار.",
    currency: "ج",
  },
  en: {
    confirmation: "Booking confirmation",
    guest: "Name",
    checkIn: "Check-in",
    checkOut: "Check-out",
    from: "from",
    until: "before",
    nights: (n) => (n === 1 ? "1 night" : `${n} nights`),
    rooms: (n) => (n === 1 ? "Room" : "Rooms"),
    guests: (n) => (n === 1 ? "1 guest" : `${n} guests`),
    rooms_line: "Rooms",
    extras: "Extras",
    total: "Total",
    paid: "Paid",
    owed: "Balance due",
    settled: "Paid in full",
    policy: "Cancellation policy",
    address: "Address",
    thanks: "We look forward to hosting you — just message us with any question.",
    currency: "EGP",
  },
  ru: {
    confirmation: "Подтверждение брони",
    guest: "Имя",
    checkIn: "Заезд",
    checkOut: "Выезд",
    from: "с",
    until: "до",
    nights: (n) => (n === 1 ? "1 ночь" : n < 5 ? `${n} ночи` : `${n} ночей`),
    rooms: (n) => (n === 1 ? "Номер" : "Номера"),
    guests: (n) => (n === 1 ? "1 гость" : n < 5 ? `${n} гостя` : `${n} гостей`),
    rooms_line: "Номера",
    extras: "Дополнительно",
    total: "Итого",
    paid: "Оплачено",
    owed: "К оплате",
    settled: "Оплачено полностью",
    policy: "Условия отмены",
    address: "Адрес",
    thanks: "Ждём вас — напишите нам, если будут вопросы.",
    currency: "EGP",
  },
  de: {
    confirmation: "Buchungsbestätigung",
    guest: "Name",
    checkIn: "Anreise",
    checkOut: "Abreise",
    from: "ab",
    until: "bis",
    nights: (n) => (n === 1 ? "1 Nacht" : `${n} Nächte`),
    rooms: (n) => (n === 1 ? "Zimmer" : "Zimmer"),
    guests: (n) => (n === 1 ? "1 Gast" : `${n} Gäste`),
    rooms_line: "Zimmer",
    extras: "Zusatzleistungen",
    total: "Gesamt",
    paid: "Bezahlt",
    owed: "Offener Betrag",
    settled: "Vollständig bezahlt",
    policy: "Stornierungsbedingungen",
    address: "Adresse",
    thanks: "Wir freuen uns auf Sie — schreiben Sie uns bei Fragen jederzeit.",
    currency: "EGP",
  },
  it: {
    confirmation: "Conferma di prenotazione",
    guest: "Nome",
    checkIn: "Check-in",
    checkOut: "Check-out",
    from: "dalle",
    until: "entro le",
    nights: (n) => (n === 1 ? "1 notte" : `${n} notti`),
    rooms: (n) => (n === 1 ? "Camera" : "Camere"),
    guests: (n) => (n === 1 ? "1 ospite" : `${n} ospiti`),
    rooms_line: "Camere",
    extras: "Extra",
    total: "Totale",
    paid: "Pagato",
    owed: "Saldo da pagare",
    settled: "Saldato",
    policy: "Politica di cancellazione",
    address: "Indirizzo",
    thanks: "Vi aspettiamo — scriveteci per qualsiasi domanda.",
    currency: "EGP",
  },
};

const LONG_DATE = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

/** "14:00:00" → "2:00 PM" / "٢:٠٠ م". */
export function formatTime(value, locale = "ar") {
  if (!value) return "";
  const [hours, minutes] = String(value).split(":");
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes) || 0));
  return date.toLocaleTimeString(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC",
  });
}

function money(amount, locale) {
  return `${formatNumber(amount, locale)} ${currencyWord(locale)}`;
}

export function propertyName(property, locale) {
  if (!property) return "";
  return locale === "ar"
    ? (property.name || property.name_en || "")
    : (property.name_en || property.name || "");
}

/**
 * The hotel writes this twice — once in Arabic, once in English. A Russian
 * or German guest gets the English one: the alternative is Arabic text in a
 * German document, which is worse than English text in a German document.
 */
export function cancellationPolicy(property, locale) {
  const settings = property?.settings || {};
  return locale === "ar"
    ? (settings.cancellation_policy || "")
    : (settings.cancellation_policy_en || settings.cancellation_policy || "");
}

/**
 * `rooms` are the live allocations: [{ number, occupancy }]. Cancelled ones
 * must never reach here — the guest would be told to go to a room that is
 * no longer theirs.
 */
export function buildConfirmation({ property, booking, rooms = [], locale = "ar" }) {
  const words = labelsFor(LABELS, locale);
  const nights = countNights(booking.check_in, booking.check_out);
  const total = Number(booking.total_amount) || 0;
  const paid = Number(booking.paid_amount) || 0;
  const owed = total - paid;

  const checkInTime = formatTime(property?.default_check_in_time, locale);
  const checkOutTime = formatTime(property?.default_check_out_time, locale);
  const guestCount = rooms.reduce((sum, room) => sum + (Number(room.occupancy) || 0), 0)
    || Number(booking.adults) || 0;

  const lines = [
    `*${propertyName(property, locale)}*`,
    `${words.confirmation} ${booking.reference || ""}`.trim(),
    "",
    `${words.guest}: ${booking.guests?.full_name || ""}`,
    `${words.checkIn}: ${formatDate(booking.check_in, locale, LONG_DATE)}${checkInTime ? ` — ${words.from} ${checkInTime}` : ""}`,
    `${words.checkOut}: ${formatDate(booking.check_out, locale, LONG_DATE)}${checkOutTime ? ` — ${words.until} ${checkOutTime}` : ""}`,
    [words.nights(nights),
      rooms.length ? `${words.rooms(rooms.length)}: ${rooms.map((r) => r.number).join(" / ")}` : null,
      guestCount ? words.guests(guestCount) : null].filter(Boolean).join(" · "),
    "",
  ];

  // The guest asks what the extra charge was for. Showing the room half on
  // its own answers that before they have to ask.
  const extras = chargesTotal(booking.booking_charges);
  if (extras > 0) {
    lines.push(`${words.rooms_line}: ${money(total - extras, locale)}`);
    lines.push(`${words.extras}: ${money(extras, locale)}`);
  }
  lines.push(`${words.total}: ${money(total, locale)}`);

  // Repeating the amount paid next to "paid in full" tells the guest nothing
  // the total above hasn't already said.
  if (owed > 0) {
    if (paid > 0) lines.push(`${words.paid}: ${money(paid, locale)}`);
    lines.push(`${words.owed}: ${money(owed, locale)}`);
  } else {
    lines.push(words.settled);
  }

  const policy = cancellationPolicy(property, locale);
  if (policy) lines.push("", `${words.policy}: ${policy}`);

  const address = property?.settings?.address;
  if (address) lines.push(`${words.address}: ${address}`);

  lines.push("", words.thanks);

  return lines.join("\n");
}

/** wa.me wants digits only, country code included and no leading plus. */
export function whatsappLink(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return digits ? `https://wa.me/${digits}${query}` : null;
}
