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
 * Two spellings of one name.
 *
 * Arabic is written several ways for the same person — أحمد and احمد, دعاء
 * محمد and دعاءمحمد — and the difference is orthography, not identity.
 * Folding those is what keeps the same guest from getting a second row when
 * reception types their name slightly differently the next time.
 */
export function sameName(a, b) {
  return foldName(a) === foldName(b) && foldName(a) !== "";
}

function foldName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")   // أ إ آ  →  ا
    .replace(/\u0629/g, "\u0647")                 // ة  →  ه
    .replace(/\u0649/g, "\u064a")                 // ى  →  ي
    .replace(/[\u064b-\u0652\u0640]/g, "")        // harakat and tatweel
    .replace(/\s+/g, "");
}

/** The distinct names already recorded against one number. */
export function namesOnPhone(existing, phone) {
  const seen = [];
  for (const guest of (existing || []).filter((g) => samePhone(g.phone, phone))) {
    const name = String(guest.full_name || "").trim();
    if (name && !seen.some((other) => sameName(other, name))) seen.push(name);
  }
  return seen;
}

/**
 * Whether a booking about to be taken should reuse a guest instead of
 * creating another row.
 *
 * The name decides, and the number only narrows the search. It used to be
 * the other way round — any row on the number would do, on the reasoning
 * that a family shares one mobile — and that turned out to be wrong about
 * how this hotel works. Reception enters the **company's** number and tells
 * the guests apart by name, so one number legitimately belongs to dozens of
 * different people. Four September bookings were filed under a guest none
 * of them were, and the name that had been typed was thrown away without a
 * word.
 *
 * So: same number and same name is the same person, and gets reused. Same
 * number and a different name is a different person, and gets their own row
 * — which is what the register is for.
 */
export function guestToReuse(existing, { name, phone }) {
  if (!normalisePhone(phone)) return null;
  const matches = (existing || [])
    .filter((g) => samePhone(g.phone, phone) && sameName(g.full_name, name));
  return matches.length ? pickGuest(matches) : null;
}
