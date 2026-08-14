import { formatDate } from "./format";

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
