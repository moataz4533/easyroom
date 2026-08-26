/**
 * Why a booking was cancelled.
 *
 * The field existed and collected nothing. Twenty-one cancellations in the
 * live database, and every single one of them says `greekclub` — the
 * reception's own username, typed into a box that asked "why?" in free
 * text. A question nobody knows how to answer is a question that returns no
 * answers, and the cancellation count stayed a mystery it did not have to
 * be.
 *
 * So the answers are named. Five of them, each one something that actually
 * happens at the desk, and `other` still opens a box for the case nobody
 * foresaw.
 *
 * `date_change` is in the list on purpose: it is the one reason that means
 * the app failed rather than the guest changed. Four bookings in a single
 * week were a stay being lengthened, entered as a new booking because the
 * dates could not be changed on the old one. If that reason keeps being
 * picked, the fix is not here.
 */
export const CANCEL_REASONS = [
  "guest_cancelled", "date_change", "duplicate", "mistake", "other",
];

const NAMED = new Set(CANCEL_REASONS.filter((key) => key !== "other"));

/**
 * Whether a stored value is one of the named reasons, or free text.
 *
 * Everything cancelled before this existed is free text, and stays
 * readable: the screen shows an unknown value exactly as it was typed
 * rather than hiding it or printing a missing key.
 */
export function isNamedReason(value) {
  return NAMED.has(String(value || ""));
}

/** Nothing is stored until a reason is chosen; `other` needs its words. */
export function cancelProblem(choice, text) {
  if (!choice) return "needCancelReason";
  if (choice === "other" && !String(text || "").trim()) return "needCancelWords";
  return null;
}

/**
 * What actually goes into the column: the key for a named reason, the
 * typed words for `other`. Keys rather than Arabic so the reason reads in
 * whatever language the screen is in, and so counting them later is
 * counting values and not spellings.
 */
export function cancelReason(choice, text) {
  return choice === "other" ? String(text || "").trim() : choice;
}
