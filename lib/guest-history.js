import { countNights } from "./format";

/**
 * A guest's history at one hotel.
 *
 * "At one hotel" is the whole shape of it: guests belong to a property, so a
 * person who stayed at two hotels is two separate records with two separate
 * histories. Nothing here ever looks across properties, and the isolation in
 * the database would not allow it anyway.
 */

// A stay that happened or is going to. A cancellation is part of the history
// but is not a visit, and counting it as one would flatter every guest.
const REAL = ["confirmed", "checked_in", "checked_out"];

export function realStays(bookings) {
  return (bookings || []).filter((booking) => REAL.includes(booking.status));
}

export function sortStays(bookings) {
  return (bookings || []).slice().sort((a, b) => String(b.check_in).localeCompare(String(a.check_in)));
}

export function summariseStays(bookings) {
  const stays = realStays(bookings);
  const all = bookings || [];

  const nights = stays.reduce((total, stay) => total + countNights(stay.check_in, stay.check_out), 0);
  const charged = stays.reduce((total, stay) => total + (Number(stay.total_amount) || 0), 0);
  const paid = stays.reduce((total, stay) => total + (Number(stay.paid_amount) || 0), 0);
  const dates = stays.map((stay) => stay.check_in).sort();

  return {
    stays: stays.length,
    nights,
    charged,
    paid,
    outstanding: Math.max(0, charged - paid),
    firstVisit: dates[0] || null,
    lastVisit: dates[dates.length - 1] || null,
    cancelled: all.filter((booking) => booking.status === "cancelled").length,
    noShows: all.filter((booking) => booking.status === "no_show").length,
  };
}

/** Someone who has been here before is worth greeting differently. */
export function isReturning(summary) {
  return (summary?.stays || 0) > 1;
}

/**
 * A guest who books and then does not turn up, repeatedly, is a fact
 * reception should see before promising the last free room on a busy night.
 */
export function isUnreliable(summary) {
  return (summary?.noShows || 0) >= 2;
}

export function averageStayLength(summary) {
  if (!summary?.stays) return 0;
  return summary.nights / summary.stays;
}
