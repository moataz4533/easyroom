/**
 * Pricing a new room type from one that already has prices.
 *
 * The matrix is one box per (room type × rate plan × head count). Splitting
 * «غرفة» into «دبل» and «كينج» does not double the typing — it adds eight
 * empty boxes per new type, per plan, and every one of them has to be right
 * or a booking quotes zero. A hotel whose king is the double plus two
 * hundred pounds should be able to say exactly that.
 *
 * Nothing here writes anything. It fills the draft the matrix is already
 * showing, so the numbers are on screen to be looked at and changed before
 * the manager password is even asked for.
 */

/** The matrix key, kept in step with the one the screen uses. */
export const key = (typeId, planId, occupancy) => `${typeId}|${planId}|${occupancy}`;

/**
 * The prices of one type, moved onto another.
 *
 * Only boxes the source actually has a price in are copied: an empty box in
 * the source means "this many people do not fit", and copying a blank over
 * a filled box would quietly unprice a room.
 *
 * The adjustment is a flat amount, a percentage, or both — «زي الدبل زائد
 * ٢٠٠» and «زي الدبل زائد ١٠٪» are both things people say. Percent first,
 * then the amount, and the result is whole pounds because nobody quotes a
 * room in piastres.
 */
export function copiedRates(rates, { from, to, plans, maxOccupancy, addAmount = 0, addPercent = 0 }) {
  const filled = {};
  if (!from || !to || from === to) return filled;

  const percent = Number(addPercent) || 0;
  const amount = Number(addAmount) || 0;

  for (const plan of plans || []) {
    for (let heads = 1; heads <= (Number(maxOccupancy) || 0); heads += 1) {
      const source = rates?.[key(from, plan.id, heads)];
      if (source === "" || source === null || source === undefined) continue;
      const base = Number(source);
      if (!Number.isFinite(base)) continue;
      filled[key(to, plan.id, heads)] = Math.max(0, Math.round(base * (1 + percent / 100) + amount));
    }
  }
  return filled;
}

/** How many boxes a copy would fill, for saying so before it happens. */
export function copyCount(rates, options) {
  return Object.keys(copiedRates(rates, options)).length;
}
