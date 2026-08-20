/**
 * The companies the hotel deals with.
 *
 * A booking can already be filed against a company, and a company can carry
 * its own rate plan — that is what makes an agency's rooms price themselves
 * without reception remembering the deal. What was missing was any way to
 * put a company into the list: the picker on the booking screen hid itself
 * when the table was empty, which it always was.
 *
 * Everything here is pure, so what may be saved and what actually gets
 * written can be tested without a screen or a database.
 */
import { sameName } from "./guest-match";

/** The form as it opens: whatever the company already says. */
export function accountForm(account) {
  return {
    name: account?.name || "",
    rate_plan_id: account?.rate_plan_id || "",
    contact_name: account?.contact_name || "",
    contact_phone: account?.contact_phone || "",
    notes: account?.notes || "",
  };
}

export const EMPTY_ACCOUNT = accountForm(null);

/**
 * Refused before it reaches the database, in the language of the desk.
 *
 * The name is checked against the other companies here and not only by the
 * unique index, because two spellings of one agency — «حكاية تريب» and
 * «حكايه تريب» — pass that index and then sit in the picker as two
 * companies with one set of prices between them. Same folding as guests,
 * for the same reason.
 */
export function accountProblem(form, others) {
  const name = String(form?.name || "").trim();
  if (!name) return "needCompanyName";
  if ((others || []).some((other) => sameName(other?.name, name))) return "nameTaken";
  return null;
}

/** Everything but the name may be left blank; blank is stored as nothing. */
const clean = (value) => String(value || "").trim() || null;

export function accountInsert(form, propertyId) {
  return {
    property_id: propertyId,
    name: String(form.name).trim(),
    rate_plan_id: form.rate_plan_id || null,
    contact_name: clean(form.contact_name),
    contact_phone: clean(form.contact_phone),
    notes: clean(form.notes),
  };
}

/**
 * Only what actually changed. A save that rewrites every field puts a row
 * into the log for a company nobody touched.
 */
export function accountChanges(form, account) {
  const patch = {};
  const was = accountForm(account);
  for (const field of ["name", "contact_name", "contact_phone", "notes"]) {
    if (String(form[field] || "").trim() !== String(was[field] || "").trim()) {
      patch[field] = field === "name" ? String(form.name).trim() : clean(form[field]);
    }
  }
  if ((form.rate_plan_id || "") !== (was.rate_plan_id || "")) {
    patch.rate_plan_id = form.rate_plan_id || null;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * How many bookings each company has. The screen shows it because it is the
 * one number that says whether a company is really in use — and because a
 * company with bookings behind it is one to hide rather than argue with.
 */
export function bookingCounts(bookings) {
  const counts = {};
  for (const booking of bookings || []) {
    if (!booking?.account_id) continue;
    counts[booking.account_id] = (counts[booking.account_id] || 0) + 1;
  }
  return counts;
}

/** Live companies first, then alphabetically — the order of a picker. */
export function sortAccounts(accounts, locale = "ar") {
  return [...(accounts || [])].sort((a, b) => {
    if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), locale === "en" ? "en" : "ar");
  });
}
