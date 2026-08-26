/**
 * Adding a kind of room.
 *
 * The screen for this has existed since the first week and the hotel never
 * used it: six rooms, one type called «غرفة», while the desk was quoting
 * «غرفتين دبل وغرفة كينج» to an agency. A difference the hotel sells on and
 * the system cannot see cannot be priced or booked against.
 *
 * The form was the reason. Of its six fields, one was a `code` — required,
 * and a thing no hotel owner has any reason to invent — and two were
 * descriptions written to columns that no screen anywhere reads. So the
 * first thing between the owner and a room type was a technical question
 * with no right answer.
 *
 * The code is still a column, and still unique per hotel, so it is derived
 * here instead of asked for.
 */
import { sameName } from "./guest-match";

/** The form as it opens. */
export function typeForm(type) {
  return {
    name: type?.name || "",
    name_en: type?.name_en || "",
    max_occupancy: Number(type?.max_occupancy) || 2,
  };
}

export const EMPTY_TYPE = typeForm(null);

const MAX_HEADS = 6;

/**
 * Refused before it reaches the database, in the language of the desk.
 *
 * Two types with the same name are worse than useless: the rates matrix
 * shows a tab per type, and two tabs reading «دبل» is a coin toss over
 * which one a booking gets priced from.
 */
export function typeProblem(form, others) {
  const name = String(form?.name || "").trim();
  if (!name) return "needTypeName";
  if ((others || []).some((other) => sameName(other?.name, name))) return "typeNameTaken";
  const heads = Number(form?.max_occupancy);
  if (!Number.isFinite(heads) || heads < 1 || heads > MAX_HEADS) return "typeHeadsRange";
  return null;
}

/**
 * A code the hotel never has to think about.
 *
 * Latin letters from the English name if there is one, else from the Arabic
 * — which usually leaves nothing, and that is fine: a numbered code is a
 * label, and the name is what people read. Uniqueness matters because the
 * database enforces it, so a clash counts up rather than failing.
 */
export function typeCode(form, taken = []) {
  const used = new Set((taken || []).map((code) => String(code || "").toUpperCase()));
  const letters = `${form?.name_en || ""} ${form?.name || ""}`
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const stem = letters || "TYPE";
  if (!used.has(stem)) return stem;
  for (let n = 2; n < 100; n += 1) {
    const next = `${stem}${n}`;
    if (!used.has(next)) return next;
  }
  return `${stem}${Date.now() % 1000}`;
}

/** What actually gets written for a new type. */
export function typeInsert(form, propertyId, taken, sortOrder) {
  const heads = Number(form.max_occupancy);
  return {
    property_id: propertyId,
    code: typeCode(form, taken),
    name: String(form.name).trim(),
    name_en: String(form.name_en || "").trim() || null,
    max_occupancy: heads,
    // The database checks base <= max, so a single room cannot be seeded
    // with a base of two.
    base_occupancy: Math.min(2, heads),
    sort_order: sortOrder,
  };
}
