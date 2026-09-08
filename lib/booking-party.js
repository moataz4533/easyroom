/**
 * Who the booking is for: a walk-in guest paying their own bill, or a
 * company or agency booking on an agreed price list.
 *
 * The desk's whole price list was named «… شركات» and every one of those
 * ten plans was offered to every guest, agency or not. The party is the
 * question that comes first — pick it, and only the prices that apply are
 * on the screen.
 */
export const PARTIES = ["direct", "company"];

export function isParty(value) {
  return PARTIES.includes(String(value || ""));
}

export function partyOf(plan) {
  return isParty(plan?.party) ? plan.party : "direct";
}

export function plansForParty(plans, party) {
  return (plans || []).filter((plan) => plan.is_active !== false && partyOf(plan) === party);
}

/**
 * Which party to open on. The hotel's default plan decides, so a hotel that
 * sells mostly to agencies opens on agencies; one whose only prices are for
 * individuals opens there. A party with no prices at all is never the
 * opening choice — that screen has nothing to offer.
 */
export function openingParty(plans, preferred = null) {
  if (isParty(preferred) && plansForParty(plans, preferred).length) return preferred;
  const fallback = (plans || []).find((plan) => plan.is_default && plan.is_active !== false);
  if (fallback && plansForParty(plans, partyOf(fallback)).length) return partyOf(fallback);
  return PARTIES.find((party) => plansForParty(plans, party).length) || "direct";
}

/** The plan to select when the party changes: its default, else its first. */
export function planForParty(plans, party, current = null) {
  const options = plansForParty(plans, party);
  if (current && options.some((plan) => plan.id === current)) return current;
  return (options.find((plan) => plan.is_default) || options[0])?.id || "";
}

/**
 * True when a plan charges the same whatever the head count — which is the
 * case for every plan this hotel has, because their plans carry the head
 * count in the name instead. Reception was changing the guest count on a
 * room and watching the price not move, with nothing on screen saying why.
 */
export function flatByHeadCount(rates, roomTypeId, planId, counts) {
  const amounts = (counts || []).map((count) => rates[`${roomTypeId}|${planId}|${count}`]);
  const priced = amounts.filter((value) => value !== "" && value !== null && value !== undefined);
  if (priced.length < 2) return false;
  return priced.every((value) => Number(value) === Number(priced[0]));
}

/** The head counts a room can actually take, so the picker cannot be refused. */
export function headCounts(maxOccupancy) {
  const top = Math.max(1, Math.min(Number(maxOccupancy) || 1, 12));
  return Array.from({ length: top }, (unused, index) => index + 1);
}
