export const LOCALE_TAGS = { ar: "ar-EG", en: "en-GB" };

export function formatNumber(value, locale = "ar", options = {}) {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, options).format(Number(value) || 0);
}

export function formatCurrency(value, locale = "ar") {
  return new Intl.NumberFormat(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, {
    style: "currency", currency: "EGP", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function formatDate(iso, locale = "ar", options = { day: "numeric", month: "short" }) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(LOCALE_TAGS[locale] || LOCALE_TAGS.ar, options);
}

export function countNights(checkIn, checkOut) {
  return Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
}

export function totalQuote(lines) {
  return lines.reduce((total, line) => total + (Number(line.amount) || 0), 0);
}
