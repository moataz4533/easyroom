/**
 * Correcting a booking that is already taken.
 *
 * Reception asked for this on the first day of real use, and the reason is
 * ordinary: the name was typed wrong, the room was booked for two and three
 * turned up, a note was missed. None of that is a cancellation, and until
 * now cancelling was the only thing the screen offered.
 *
 * Kept pure so the rules can be tested without a screen or a database. What
 * to write is worked out here; the screen only sends it.
 */

/** The form as it opens: whatever the booking already says. */
export function editForm(booking, allocations) {
  return {
    full_name: booking?.guests?.full_name || "",
    phone: booking?.guests?.phone || "",
    notes: booking?.notes || "",
    occupancy: Object.fromEntries(
      (allocations || []).map((a) => [a.id, Number(a.occupancy) || 1])
    ),
  };
}

/** What a room may hold, from the type behind it. Falls back to what is
 *  already booked, so a missing join can never make a valid stay invalid. */
export function maxOccupancy(allocation) {
  return Number(allocation?.rooms?.room_types?.max_occupancy)
    || Number(allocation?.occupancy) || 1;
}

/**
 * Refused before it reaches the database, in the language of the desk. The
 * occupancy cap is also a trigger in the database — this is for the person
 * typing, that one is for the data.
 */
export function editProblem(form, allocations) {
  if (!String(form?.full_name || "").trim()) return "needGuestName";
  for (const allocation of allocations || []) {
    const heads = Number(form?.occupancy?.[allocation.id]);
    if (!Number.isFinite(heads) || heads < 1) return "needPax";
    if (heads > maxOccupancy(allocation)) return "tooManyPax";
  }
  return null;
}

const trimmed = (value) => String(value || "").trim();

/**
 * Only what actually changed. Writing every field on every save would put
 * three rows into the activity log for a booking nobody touched, and would
 * rewrite a room's nights — and its price — for an edit to a note.
 */
export function editChanges(form, booking, allocations) {
  const guest = {};
  if (trimmed(form.full_name) !== trimmed(booking?.guests?.full_name)) {
    guest.full_name = trimmed(form.full_name);
  }
  if (trimmed(form.phone) !== trimmed(booking?.guests?.phone)) {
    guest.phone = trimmed(form.phone) || null;
  }

  const bookingFields = {};
  if (trimmed(form.notes) !== trimmed(booking?.notes)) {
    bookingFields.notes = trimmed(form.notes) || null;
  }

  const rooms = (allocations || [])
    .filter((a) => Number(form?.occupancy?.[a.id]) !== (Number(a.occupancy) || 0))
    .map((a) => ({ id: a.id, occupancy: Number(form.occupancy[a.id]) }));

  return {
    guest: Object.keys(guest).length ? guest : null,
    booking: Object.keys(bookingFields).length ? bookingFields : null,
    rooms,
    any: Boolean(Object.keys(guest).length || Object.keys(bookingFields).length || rooms.length),
  };
}

/**
 * Has the guest's stay begun?
 *
 * This decides which of two buttons the screen offers, and it deliberately
 * does not ask whether anybody pressed "check in". A booking entered after
 * the guest already arrived is never marked checked-in — the check-in button
 * only appears in today's arrivals — and reception was left with "cancel the
 * whole booking" as the only action on a guest who was standing in the room
 * asking to leave a day early.
 *
 * A stay that has started can end early. One that has not can be a no-show.
 */
export function stayStarted(booking, today) {
  if (!booking?.check_in || !today) return false;
  return String(booking.check_in) <= String(today);
}

/**
 * A booking whose arrival date has passed, that covers today, and that
 * nobody has checked in. These are the ones the arrivals list misses.
 */
export function awaitingCheckIn(booking, today) {
  return booking?.status === "confirmed"
    && stayStarted(booking, today)
    && String(booking.check_out) > String(today);
}
