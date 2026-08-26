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

let zone = null;
let currency = FALLBACK_CURRENCY;

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
}

export function hotelZone() {
  return zone || deviceZone();
}

export function hotelCurrency() {
  return currency;
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
  return WORDS[iso]?.[locale === "en" ? "en" : "ar"] || iso;
}
