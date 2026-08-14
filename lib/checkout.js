/**
 * What an early departure costs, both ways, before anybody commits to one.
 *
 * Reception should not be choosing between two words. They should be looking
 * at the two amounts, with the guest in front of them, and picking the one
 * the hotel means. So this works out exactly what the database will charge
 * for each choice, from the nights as they were sold.
 *
 * Pure on purpose: getting this wrong shows a guest a price the bill then
 * disagrees with, and that is worth a test rather than a glance.
 */

/**
 * `nights` is the allocation_nights rows for the booking:
 *   [{ allocation_id, night: "2026-08-15", amount: 1200 }, …]
 *
 * Returns { stayed, booked, unstayed, nightsStayed, nightsBooked }.
 */
export function earlyDepartureAmounts(nights, today) {
  const rows = (nights || []).filter((n) => n?.night && Number.isFinite(Number(n.amount)));

  const booked = rows.reduce((sum, n) => sum + Number(n.amount), 0);
  const past = rows.filter((n) => n.night < today);

  // A guest who arrives and leaves the same morning still pays for the night
  // they held the room, which is what check_out_booking does with
  // greatest(starts_on + 1, …). Charging nothing would be a free stay.
  const stayed = past.length > 0
    ? past.reduce((sum, n) => sum + Number(n.amount), 0)
    : firstNightPerAllocation(rows);

  return {
    stayed,
    booked,
    unstayed: Math.max(0, booked - stayed),
    nightsStayed: past.length > 0 ? countNightsIn(past) : (rows.length ? 1 : 0),
    nightsBooked: countNightsIn(rows),
  };
}

function firstNightPerAllocation(rows) {
  const first = new Map();
  for (const row of rows) {
    const seen = first.get(row.allocation_id);
    if (!seen || row.night < seen.night) first.set(row.allocation_id, row);
  }
  return [...first.values()].reduce((sum, n) => sum + Number(n.amount), 0);
}

// Nights, not room-nights: two rooms on the same date is one night of stay.
function countNightsIn(rows) {
  return new Set(rows.map((n) => n.night)).size;
}

/** Whether there is anything to ask about at all. */
export function isLeavingEarly(endsOn, today) {
  return Boolean(endsOn) && endsOn > today;
}
