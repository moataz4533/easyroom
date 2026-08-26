/**
 * The same guest, booked twice for the same nights.
 *
 * It happens in two shapes, and the live database has both. Four bookings
 * under one name for 21–25 September, taken over an afternoon — the same
 * request entered again because nobody could see the first one. And two
 * bookings for عمار الغواص across 17–21 August, **both still confirmed**,
 * which means a room is being held for a guest who only needs one.
 *
 * The screen warns and then gets out of the way. Two rooms for one family
 * under one name is a real booking, and a desk that cannot take it is worse
 * than a desk that asks twice — so this never refuses, it only makes sure
 * the second booking is a decision rather than an accident.
 *
 * Identity here is the same rule the guest lookup uses: the name decides,
 * and the number is corroboration. A hotel where one company number covers
 * dozens of guests taught us that the other way round is wrong.
 */
import { normalisePhone, samePhone, sameName } from "./guest-match";

/** The statuses that actually hold a room. */
const LIVE = new Set(["confirmed", "checked_in", "inquiry"]);

/** Two stays share at least one night. Departure day is not a night. */
export function overlaps(stay, { checkIn, checkOut }) {
  return String(stay?.check_in) < String(checkOut)
    && String(stay?.check_out) > String(checkIn);
}

/** Whether a booking on file belongs to the guest being typed in. */
export function sameGuest(stay, { name, phone }) {
  const on = stay?.guests || {};
  if (sameName(on.full_name, name)) return true;
  return Boolean(normalisePhone(phone)) && samePhone(on.phone, phone);
}

/**
 * The bookings this one would duplicate: same guest, nights in common, and
 * still holding a room. Sorted by arrival so the earliest reads first.
 */
export function clashingStays(existing, { name, phone, checkIn, checkOut }) {
  if (!checkIn || !checkOut) return [];
  if (!String(name || "").trim() && !normalisePhone(phone)) return [];
  return (existing || [])
    .filter((stay) => LIVE.has(stay?.status))
    .filter((stay) => overlaps(stay, { checkIn, checkOut }))
    .filter((stay) => sameGuest(stay, { name, phone }))
    .sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)));
}

/** The rooms a clashing stay is holding, for saying which ones out loud. */
export function roomsOf(stay) {
  return (stay?.room_allocations || [])
    .filter((a) => !a.released_at)
    .map((a) => a.rooms?.number)
    .filter(Boolean);
}
