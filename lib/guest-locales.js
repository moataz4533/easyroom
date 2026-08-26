/**
 * The languages a guest's paperwork can be written in.
 *
 * Deliberately not the same list as the app's interface. The interface is
 * read by four people who work here every day and two languages cover them;
 * the confirmation, the bill and the reservation proof are read once by a
 * stranger, and in Dahab that stranger is as likely to be Russian, German
 * or Italian as anything else.
 *
 * The costs are not comparable either — about fifty-five strings per
 * language here against more than eleven hundred for the interface — which
 * is why this list grows and that one does not.
 */
export const GUEST_LOCALES = ["ar", "en", "ru", "de", "it"];

/** Each language named in itself, which is how anybody finds their own. */
export const LANGUAGE_NAMES = {
  ar: "العربية",
  en: "English",
  ru: "Русский",
  de: "Deutsch",
  it: "Italiano",
};

/** Arabic is the only one of these written right to left. */
export function isRtl(locale) {
  return locale === "ar";
}

/**
 * Which label table to fall back to.
 *
 * A language with no table of its own must land on English, not on Arabic:
 * an Italian guest who gets «الإجمالي» has been handed the wrong document,
 * while one who gets "Total" has been handed a slightly plain one.
 */
export function labelsFor(tables, locale) {
  return tables[locale] || tables.en || tables.ar;
}
