/**
 * Discounts on a room.
 *
 * The twin of `discounted_rate` in the database. The database is the
 * authority — every stored price comes from it — and this exists so a screen
 * can show what a discount will do before anybody commits to it. The two are
 * held to the same answers by tests/discount.test.js; if you change one,
 * change the other in the same commit.
 *
 * Three shapes, because a small hotel uses all three:
 *   percent — a share off the night
 *   amount  — a fixed sum off the night
 *   rate    — the night's price named outright
 */

export const DISCOUNT_KINDS = ["percent", "amount", "rate"];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** What one night costs after the discount. Never below zero. */
export function discountedRate(list, kind, value) {
  const base = round2(list);
  if (!kind || value === null || value === undefined || value === "") return Math.max(base, 0);
  const v = Number(value);
  if (!Number.isFinite(v)) return Math.max(base, 0);
  if (kind === "percent") return Math.max(round2((base * (100 - v)) / 100), 0);
  if (kind === "amount") return Math.max(round2(base - v), 0);
  if (kind === "rate") return Math.max(round2(v), 0);
  return Math.max(base, 0);
}

/**
 * A whole stay, from its per-night list prices. Nights are passed rather
 * than a total, because a stay crossing a season is not the same night
 * repeated — and a fixed sum off is capped at each night's own price, not at
 * the stay's.
 */
export function discountedStay(nightlyList, kind, value) {
  const nights = (nightlyList || []).map((list) => ({
    list: round2(list),
    net: discountedRate(list, kind, value),
  }));
  const list = round2(nights.reduce((sum, n) => sum + n.list, 0));
  const net = round2(nights.reduce((sum, n) => sum + n.net, 0));
  return { nights: nights.length, list, net, discount: round2(list - net) };
}

/**
 * The preview on the new-booking screen has one number to work from — what
 * `quote_stay` answered for the whole stay — and not the nights behind it.
 * Spreading it evenly is exact for a percentage and for a named rate, and
 * off only for a fixed sum against a night cheaper than the sum itself,
 * which the database then settles. It is a quote, and it says so.
 */
export function previewStay(stayTotal, nights, kind, value) {
  const count = Math.max(Number(nights) || 0, 0);
  if (count === 0) return { nights: 0, list: 0, net: 0, discount: 0 };
  const perNight = round2(Number(stayTotal) || 0) / count;
  return discountedStay(Array.from({ length: count }, () => perNight), kind, value);
}

/**
 * Refused before it reaches the database, in the language of the desk. The
 * database checks the same things again — this is for the person typing,
 * not for the data.
 */
export function discountProblem(kind, value) {
  if (!kind) return null;
  if (!DISCOUNT_KINDS.includes(kind)) return "unknownKind";
  if (value === null || value === undefined || String(value).trim() === "") return "needValue";
  const v = Number(value);
  if (!Number.isFinite(v)) return "needValue";
  if (v < 0) return "negative";
  if (kind === "percent" && v > 100) return "overHundred";
  if (kind === "percent" && v === 0) return "noDiscount";
  if (kind === "amount" && v === 0) return "noDiscount";
  return null;
}

/** Whether an allocation row carries a discount at all. */
export function hasDiscount(allocation) {
  return Boolean(allocation?.discount_kind);
}

/**
 * The form's shape, read off an allocation. Kept here so the screen has one
 * place to go from a stored row to editable fields and back.
 */
export function discountForm(allocation) {
  return {
    kind: allocation?.discount_kind || "",
    value: allocation?.discount_value === null || allocation?.discount_value === undefined
      ? "" : String(Number(allocation.discount_value)),
    note: allocation?.discount_note || "",
  };
}

/** The money taken off a set of allocations — what the bill shows as one line. */
export function discountTotal(allocations) {
  return round2((allocations || [])
    .filter((a) => !a.release_reason)
    .reduce((sum, a) => sum + (Number(a.discount_amount) || 0), 0));
}
