/**
 * Extras on the bill.
 *
 * The arithmetic lives here rather than in the screen because the same
 * numbers appear in three places — the booking sheet, the confirmation
 * message, and the reports — and they have to agree.
 *
 * A voided line is never removed, only ignored: the record of what was
 * charged has to survive being wrong.
 */

export function liveCharges(charges) {
  return (charges || []).filter((charge) => !charge.voided_at);
}

export function voidedCharges(charges) {
  return (charges || []).filter((charge) => charge.voided_at);
}

export function lineTotal(quantity, unitAmount) {
  return (Number(quantity) || 0) * (Number(unitAmount) || 0);
}

export function chargesTotal(charges) {
  return liveCharges(charges).reduce((total, charge) => {
    const amount = charge.amount === null || charge.amount === undefined
      ? lineTotal(charge.quantity, charge.unit_amount)
      : Number(charge.amount) || 0;
    return total + amount;
  }, 0);
}

/**
 * The database keeps one total, which already includes the extras. Reception
 * still needs to see the room half on its own when a guest queries the bill.
 */
export function roomsSubtotal(bookingTotal, charges) {
  return Math.max(0, (Number(bookingTotal) || 0) - chargesTotal(charges));
}

/**
 * Returns a message key, or null when the line is good. Kept as keys rather
 * than sentences so the same rules read in both languages.
 */
export function validateCharge({ description, quantity, amount }) {
  if (!String(description || "").trim()) return "needDescription";

  const count = Number(quantity);
  if (!Number.isFinite(count) || count <= 0) return "needQuantity";

  // An untouched price field is blank, and Number("") is 0 — without this
  // check a forgotten price would be recorded as a line the hotel gave away.
  if (String(amount ?? "").trim() === "") return "needAmount";
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return "needAmount";

  return null;
}

export function chargeLabel(charge, items, locale = "ar") {
  const item = (items || []).find((candidate) => candidate.id === charge.charge_item_id);
  if (!item) return charge.description;
  return locale === "en" ? (item.name_en || item.name) : (item.name || item.name_en);
}
