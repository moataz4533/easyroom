/**
 * The two things every screen assumes about a hotel without asking it.
 *
 * `today()` decided the day in Africa/Cairo, and money printed as Egyptian
 * pounds — both written into the code, both already columns on the
 * property, and neither ever read. For this hotel the assumption happens to
 * be true, which is exactly why it survived: a hotel in Riyadh would have
 * had the wrong arrivals list for the hour either side of midnight, and
 * nothing would have looked broken.
 *
 * Held here as module state rather than threaded through every caller,
 * because "what time is it at the hotel" is not an argument — it is the
 * same answer for every screen in the session. The Shell sets it once when
 * the property loads; until then the device's own zone stands in, which is
 * a better guess than someone else's country.
 */

const FALLBACK_CURRENCY = "EGP";
const FALLBACK_DIAL = "20";

let zone = null;
let currency = FALLBACK_CURRENCY;
let dial = FALLBACK_DIAL;

/** The device's own zone, asked for once and only when nothing better is known. */
function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function setHotelSettings(property) {
  zone = property?.timezone || null;
  currency = property?.currency || FALLBACK_CURRENCY;
  // Lives in `settings` rather than a column of its own: it is the same kind
  // of thing as the hotel's WhatsApp number, and needs no migration.
  dial = String(property?.settings?.dial_code || FALLBACK_DIAL).replace(/\D/g, "") || FALLBACK_DIAL;
}

export function hotelZone() {
  return zone || deviceZone();
}

export function hotelCurrency() {
  return currency;
}

/**
 * The country's dialling code, digits only — "20" for Egypt.
 *
 * It decides when two written forms are the same phone. Hardcoding Egypt's
 * meant `+9665…` and `05…` never matched each other, so a Saudi hotel would
 * quietly file one guest under two records — the exact fault that put twelve
 * rows on one number here.
 */
export function hotelDialCode() {
  return dial;
}

/**
 * What to write after the number.
 *
 * Written out rather than asked of `Intl`, because `Intl` is wrong about
 * the one currency this app has ever printed: its narrow symbol for EGP is
 * `E£`, in Arabic as well as English. No Egyptian hotel writes that, and
 * every screen in the app has said «ج» since the first week.
 *
 * So the currencies we can name are named, and anything else falls back to
 * its ISO code — which is never wrong, reads the same in both languages,
 * and is what a hotel using an unusual currency would expect to see rather
 * than a symbol somebody guessed at.
 */
const WORDS = {
  EGP: { ar: "ج", en: "EGP" },
  SAR: { ar: "ر.س", en: "SAR" },
  AED: { ar: "د.إ", en: "AED" },
  KWD: { ar: "د.ك", en: "KWD" },
  QAR: { ar: "ر.ق", en: "QAR" },
  OMR: { ar: "ر.ع", en: "OMR" },
  BHD: { ar: "د.ب", en: "BHD" },
  JOD: { ar: "د.أ", en: "JOD" },
  MAD: { ar: "د.م", en: "MAD" },
  TND: { ar: "د.ت", en: "TND" },
  LYD: { ar: "د.ل", en: "LYD" },
  USD: { ar: "$", en: "$" },
  EUR: { ar: "€", en: "€" },
  GBP: { ar: "£", en: "£" },
};

export function currencyWord(locale = "ar", code = null) {
  const iso = String(code || currency || FALLBACK_CURRENCY).toUpperCase();
  // Arabic gets the Arabic word; every other language gets the Latin one.
  // A Russian confirmation ending in «ج» is a document the guest cannot
  // finish reading.
  return WORDS[iso]?.[locale === "ar" ? "ar" : "en"] || iso;
}

/**
 * What the settings screen offers. Nothing is limited to these — the
 * currency falls back to its ISO code and the dialling code is typed — but
 * a list of the ones people actually pick beats an empty box.
 */
export const CURRENCY_CODES = Object.keys(WORDS);

export const TIMEZONES = [
  "Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar",
  "Asia/Bahrain", "Asia/Muscat", "Asia/Amman", "Asia/Beirut", "Asia/Baghdad",
  "Africa/Khartoum", "Africa/Tripoli", "Africa/Tunis", "Africa/Algiers",
  "Africa/Casablanca", "Europe/Istanbul", "Europe/London", "UTC",
];

/** Dialling codes for the countries the timezones above belong to. */
export const DIAL_CODES = [
  { code: "20", ar: "مصر", en: "Egypt" },
  { code: "966", ar: "السعودية", en: "Saudi Arabia" },
  { code: "971", ar: "الإمارات", en: "UAE" },
  { code: "965", ar: "الكويت", en: "Kuwait" },
  { code: "974", ar: "قطر", en: "Qatar" },
  { code: "973", ar: "البحرين", en: "Bahrain" },
  { code: "968", ar: "عُمان", en: "Oman" },
  { code: "962", ar: "الأردن", en: "Jordan" },
  { code: "961", ar: "لبنان", en: "Lebanon" },
  { code: "964", ar: "العراق", en: "Iraq" },
  { code: "249", ar: "السودان", en: "Sudan" },
  { code: "218", ar: "ليبيا", en: "Libya" },
  { code: "216", ar: "تونس", en: "Tunisia" },
  { code: "213", ar: "الجزائر", en: "Algeria" },
  { code: "212", ar: "المغرب", en: "Morocco" },
  { code: "90", ar: "تركيا", en: "Turkey" },
];
