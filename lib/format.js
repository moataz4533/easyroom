export const LOCALE_TAGS = { ar: "ar-EG", en: "en-GB" };

export function formatNumber(value, locale = "ar", options = {}) {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, options).format(Number(value) || 0);
}

export function formatCurrency(value, locale = "ar") {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, {
    style: "currency", currency: "EGP", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

/**
 * Hotel dates are plain calendar days, but not every column is: a payment
 * carries a full timestamp. Appending "T00:00:00" to one of those produced
 * "Invalid Date", which is what a guest's statement printed next to every
 * payment they had made. So the day is taken off the front either way.
 */
export function formatDate(iso, locale = "ar", options = { day: "numeric", month: "short" }) {
  if (!iso) return "";
  const day = String(iso).slice(0, 10);
  const at = new Date(`${day}T00:00:00`);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, options);
}

// Hotel dates are plain calendar days, never timestamps. Everything below
// works in UTC so a summer-time jump can't move a stay by a night.
export function shiftDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

export function countNights(checkIn, checkOut) {
  return daysBetween(checkIn, checkOut);
}

/**
 * Arabic separates a list with ، and English with , — a detail that shows up
 * everywhere room numbers are listed, so it lives here rather than inline.
 */
const LIST_SEPARATOR = { ar: "، ", en: ", " };

export function joinList(items, locale = "ar") {
  return (items || []).filter((item) => item !== null && item !== undefined && item !== "")
    .join(LIST_SEPARATOR[locale] || LIST_SEPARATOR.ar);
}

export function totalQuote(lines) {
  return lines.reduce((total, line) => total + (Number(line.amount) || 0), 0);
}
