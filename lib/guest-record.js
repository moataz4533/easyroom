import { formatDate } from "./format";
import { normalisePhone } from "./guest-match";

/**
 * Official guest records.
 *
 * Egyptian hotels are required to record who slept in the building: name,
 * nationality, identity document, date of birth. The columns have always
 * been in the database; this is the part that decides whether a record is
 * actually usable and turns a period into a file that can be handed over.
 */

export const REQUIRED_FIELDS = ["nationality", "id_number", "date_of_birth"];

const FIELD_LABELS = {
  ar: { nationality: "الجنسية", id_number: "رقم الإثبات", date_of_birth: "تاريخ الميلاد" },
  en: { nationality: "Nationality", id_number: "ID number", date_of_birth: "Date of birth" },
};

export function missingFields(guest, locale = "ar") {
  const labels = FIELD_LABELS[locale] || FIELD_LABELS.ar;
  return REQUIRED_FIELDS.filter((field) => !String(guest?.[field] || "").trim()).map((field) => labels[field]);
}

export function isComplete(guest) {
  return missingFields(guest).length === 0;
}

/**
 * A field can be filled in and still be wrong.
 *
 * The live database has a guest called `hl[v` on the phone number `123`.
 * Nobody typed that on purpose: the screen asked for a phone number, would
 * not go on without one, and somebody at the desk needed to take a booking.
 * That is what happens when a form blocks — the required field gets fed
 * whatever gets past it, and the register ends up with a row that is worse
 * than a blank, because a blank at least admits it knows nothing.
 *
 * So this never blocks. It says out loud what looks wrong and lets the
 * person holding the passport decide, because they can see things this
 * cannot: a walk-in at 2am with no papers is a real guest, and a seven-digit
 * foreign landline is a real number.
 *
 * The tests are the specification of what counts as implausible; each rule
 * is deliberately loose enough that a real guest never trips it.
 */
const PLAUSIBILITY_WORDS = {
  ar: {
    full_name: "الاسم",
    phone: "رقم الهاتف",
    id_number: "رقم الإثبات",
    date_of_birth: "تاريخ الميلاد",
    email: "البريد الإلكتروني",
    nameTooShort: "الاسم حرف واحد فقط",
    nameNoLetters: "الاسم ليس فيه حروف",
    nameSymbols: "الاسم فيه رموز غير معتادة",
    phoneTooShort: "رقم الهاتف قصير جداً",
    phoneTooLong: "رقم الهاتف طويل جداً",
    phoneRepeated: "رقم الهاتف رقم واحد مكرر",
    idTooShort: "رقم الإثبات قصير جداً",
    idRepeated: "رقم الإثبات رقم واحد مكرر",
    dobUnreadable: "تاريخ الميلاد غير مقروء",
    dobFuture: "تاريخ الميلاد في المستقبل",
    dobTooOld: "تاريخ الميلاد يعني عمراً فوق ١٢٠ سنة",
    emailShape: "البريد الإلكتروني ناقص",
  },
  en: {
    full_name: "Name",
    phone: "Phone",
    id_number: "ID number",
    date_of_birth: "Date of birth",
    email: "Email",
    nameTooShort: "the name is a single character",
    nameNoLetters: "the name has no letters in it",
    nameSymbols: "the name contains unusual symbols",
    phoneTooShort: "the phone number is too short to be one",
    phoneTooLong: "the phone number is too long to be one",
    phoneRepeated: "the phone number is one digit repeated",
    idTooShort: "the ID number is too short to be one",
    idRepeated: "the ID number is one character repeated",
    dobUnreadable: "the date of birth cannot be read",
    dobFuture: "the date of birth is in the future",
    dobTooOld: "the date of birth means an age over 120",
    emailShape: "the email address is incomplete",
  },
};

/** Never in a person's name; almost always in a keyboard mash or a paste. */
const NAME_SYMBOLS = /[<>{}[\]\\|=+*/#$%^~`@_]/;

/**
 * E.164 allows fifteen digits, and the shortest national numbers reachable
 * from abroad are seven. Anything outside that is not a phone number.
 */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

const OLDEST_PLAUSIBLE_AGE = 120;

function repeatedCharacter(text) {
  return text.length > 1 && /^(.)\1+$/.test(text);
}

export function implausibleFields(guest, locale = "ar", { today } = {}) {
  const w = PLAUSIBILITY_WORDS[locale] || PLAUSIBILITY_WORDS.ar;
  const found = [];
  const add = (field, key) => found.push({ field, label: w[field], message: w[key] });

  const name = String(guest?.full_name || "").trim();
  if (name) {
    if (name.length < 2) add("full_name", "nameTooShort");
    else if (!/\p{L}/u.test(name)) add("full_name", "nameNoLetters");
    else if (NAME_SYMBOLS.test(name)) add("full_name", "nameSymbols");
  }

  const phone = normalisePhone(guest?.phone);
  const digits = phone.replace(/\D/g, "");
  if (digits) {
    if (digits.length < PHONE_MIN_DIGITS) add("phone", "phoneTooShort");
    else if (digits.length > PHONE_MAX_DIGITS) add("phone", "phoneTooLong");
    else if (repeatedCharacter(digits)) add("phone", "phoneRepeated");
  }

  // Passports run six to nine characters, the Egyptian national ID is
  // fourteen. Five is below anything a real document carries.
  const id = String(guest?.id_number || "").replace(/[\s-]/g, "");
  if (id) {
    if (id.length < 5) add("id_number", "idTooShort");
    else if (repeatedCharacter(id)) add("id_number", "idRepeated");
  }

  const dob = String(guest?.date_of_birth || "").trim();
  if (dob) {
    const onDate = today || new Date().toISOString().slice(0, 10);
    const age = ageOn(dob, onDate);
    if (age === null) add("date_of_birth", "dobUnreadable");
    else if (age < 0) add("date_of_birth", "dobFuture");
    else if (age > OLDEST_PLAUSIBLE_AGE) add("date_of_birth", "dobTooOld");
  }

  const email = String(guest?.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) add("email", "emailShape");

  return found;
}

/**
 * One number for the screen: how much of this record still wants a human.
 * Missing and implausible are counted together because to whoever is looking
 * at the list they are the same job — open it and fix it.
 */
export function recordIssueCount(guest) {
  return missingFields(guest).length + implausibleFields(guest).length;
}

export function needsAttention(guest) {
  return recordIssueCount(guest) > 0;
}

/** Common nationalities in Dahab, offered as suggestions — never enforced. */
export const NATIONALITY_SUGGESTIONS = [
  "مصري", "ألماني", "روسي", "إيطالي", "بريطاني", "فرنسي", "تشيكي",
  "بولندي", "هولندي", "أمريكي", "كندي", "أوكراني", "إسباني", "سويسري", "نمساوي",
];

export function liveRoomNumbers(booking) {
  return (booking?.room_allocations || [])
    .filter((allocation) => !allocation.released_at)
    .map((allocation) => allocation.rooms?.number)
    .filter(Boolean);
}

const CSV_HEADERS = {
  ar: ["رقم الحجز", "الاسم", "الجنسية", "رقم الإثبات", "تاريخ الميلاد", "رقم الهاتف", "الغرفة", "الدخول", "الخروج"],
  en: ["Reference", "Name", "Nationality", "ID number", "Date of birth", "Phone", "Room", "Check-in", "Check-out"],
};

/**
 * A spreadsheet treats a leading =, +, - or @ as a formula, so a guest named
 * "=cmd" would execute on whoever opens the file. Quote it as text instead.
 */
function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildGuestCsv(stays, locale = "ar") {
  const headers = CSV_HEADERS[locale] || CSV_HEADERS.ar;
  const rows = (stays || []).map((stay) => [
    stay.reference,
    stay.guests?.full_name,
    stay.guests?.nationality,
    stay.guests?.id_number,
    stay.guests?.date_of_birth,
    stay.guests?.phone,
    liveRoomNumbers(stay).join(" / "),
    stay.check_in,
    stay.check_out,
  ]);

  // Dates stay as ISO in the file: this is a record to be read by other
  // systems, not a screen. The BOM is what makes Excel open Arabic correctly.
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function csvFilename(from, to) {
  return `easyroom-guests-${from}-${to}.csv`;
}

export function ageOn(dateOfBirth, onDate) {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  const at = new Date(`${onDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

export function describeGuest(guest, locale = "ar") {
  const parts = [guest?.nationality, guest?.id_number].filter(Boolean);
  if (guest?.date_of_birth) parts.push(formatDate(guest.date_of_birth, locale, { year: "numeric", month: "short", day: "numeric" }));
  return parts.join(" · ");
}
