/**
 * Moving a booking that already exists.
 *
 * Reception was cancelling and rebooking to change a departure date: four
 * times in one week, always the same guest, same arrival, later departure.
 * The database could always do this; there was nowhere to ask it from.
 *
 * Pure, so what may be asked for and what it costs can be checked without
 * a screen or a database.
 */
import { countNights, shiftDate } from "./format";

/** The form as it opens: the dates the booking already has. */
export function datesForm(booking) {
  return {
    check_in: booking?.check_in || "",
    check_out: booking?.check_out || "",
  };
}

/**
 * What reception may ask for.
 *
 * A guest already in the room did not arrive on a different day — the
 * database refuses that too, and this says so before the trip.
 */
export function datesProblem(form, booking) {
  if (!form?.check_in || !form?.check_out) return "needBothDates";
  if (form.check_out <= form.check_in) return "checkOutAfterCheckIn";
  if (form.check_in === booking?.check_in && form.check_out === booking?.check_out) {
    return "datesUnchanged";
  }
  if (booking?.status === "checked_in" && form.check_in !== booking?.check_in) {
    return "guestAlreadyIn";
  }
  return null;
}

/**
 * What the change amounts to, in the words the desk would use: how many
 * nights before, how many after, and which way it went.
 *
 * `shorter` is the one that matters beyond wording — a stay that loses
 * nights loses money, so the database asks for the manager password, and
 * the screen has to know to show the box.
 */
export function datesChange(form, booking) {
  const was = countNights(booking?.check_in, booking?.check_out) || 0;
  const now = form?.check_in && form?.check_out
    ? countNights(form.check_in, form.check_out) : was;
  return {
    was,
    now,
    delta: now - was,
    shorter: now < was,
    longer: now > was,
    moved: Boolean(form?.check_in && form.check_in !== booking?.check_in),
  };
}

/**
 * The shortcuts beside the departure field: the same "how many nights?"
 * question the new-booking screen asks, but anchored to the arrival this
 * booking already has.
 */
export function nightOptions(checkIn, counts = [1, 2, 3, 4, 5, 7]) {
  if (!checkIn) return [];
  return counts.map((nights) => ({ nights, date: shiftDate(checkIn, nights) }));
}
