/**
 * Finding the guest on the other end of the phone.
 *
 * A phone number is not unique in the guests table and never was: every
 * booking taken without searching first creates another row. The live
 * database has twelve guests on one number, which turned a lookup that
 * expected exactly one row into an error — so reception got a failure
 * instead of the returning guest they were looking at.
 *
 * Two things follow, and both live here so they cannot drift apart: which
 * of several rows is the one meant, and how to stop making more of them.
 */

/** A phone number as two people would have to type it to mean the same one. */
export function normalisePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  // Egyptian numbers are written both ways; +201118070453 and 01118070453
  // are the same phone and must match each other.
  if (digits.startsWith("+20")) return `0${digits.slice(3)}`;
  if (digits.startsWith("0020")) return `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length > 10) return `0${digits.slice(2)}`;
  return digits;
}

export function samePhone(a, b) {
  const left = normalisePhone(a);
  return Boolean(left) && left === normalisePhone(b);
}

/**
 * Of several rows on one number, the one reception means.
 *
 * The guest with a history, because that is the record their stays and
 * their balance hang off — merging behind the scenes would be worse than
 * choosing. Between two with the same history, the one seen most recently.
 */
export function pickGuest(guests, staysById = {}) {
  const rows = (guests || []).filter(Boolean);
  if (rows.length <= 1) return rows[0] || null;

  return [...rows].sort((a, b) => {
    const byStays = (staysById[b.id] || 0) - (staysById[a.id] || 0);
    if (byStays !== 0) return byStays;
    // A guest somebody bothered to fill in beats a bare name and number.
    const byDetail = detail(b) - detail(a);
    if (byDetail !== 0) return byDetail;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  })[0];
}

function detail(guest) {
  return ["email", "nationality", "id_number", "date_of_birth", "notes"]
    .filter((field) => String(guest?.[field] || "").trim()).length;
}

/**
 * How many of these rows are the same person, so the screen can say so
 * rather than silently picking one.
 */
export function duplicateCount(guests) {
  return Math.max(0, (guests || []).length - 1);
}

/**
 * Whether a booking about to be taken should reuse a guest instead of
 * creating another row. This is the fix for the cause rather than the
 * symptom: reception who types a number and goes straight to the rooms
 * without pressing search should still land on the guest they already have.
 */
export function guestToReuse(existing, { name, phone }) {
  if (!normalisePhone(phone)) return null;
  const matches = (existing || []).filter((g) => samePhone(g.phone, phone));
  if (matches.length === 0) return null;

  // A different name on the same number is a real thing — a family, one
  // mobile — so an exact name match wins if there is one.
  const wanted = String(name || "").trim().toLowerCase();
  const byName = matches.filter((g) => String(g.full_name || "").trim().toLowerCase() === wanted);
  return pickGuest(byName.length ? byName : matches);
}
