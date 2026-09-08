/**
 * The hotel's own arrival and departure hours, and whether a stay whose
 * departure has passed closes itself.
 *
 * Read from production while this was written: thirteen stays were still
 * `checked_in`, one of them fifteen days after the guest had gone, and
 * nothing anywhere on the screen said so. Reception had not been careless
 * — nothing had ever asked them.
 */
export const DEFAULT_CHECK_IN = "14:00";
export const DEFAULT_CHECK_OUT = "12:00";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value) {
  return TIME.test(String(value || ""));
}

export function hotelHours(property) {
  const settings = property?.settings || {};
  return {
    checkIn: isTime(settings.check_in_time) ? settings.check_in_time : DEFAULT_CHECK_IN,
    checkOut: isTime(settings.check_out_time) ? settings.check_out_time : DEFAULT_CHECK_OUT,
    autoClose: settings.auto_close_stays !== false,
  };
}

export function hoursProblem(form) {
  if (!isTime(form?.checkIn)) return "badCheckInTime";
  if (!isTime(form?.checkOut)) return "badCheckOutTime";
  return null;
}

/**
 * Written as the guest reads it — "2:00 PM", not "14:00" — because the
 * paper it lands on is the guest's, not the desk's. Arabic keeps Western
 * digits for the same reason the dates on that paper do.
 */
export function clockLabel(value, locale = "en") {
  if (!isTime(value)) return "";
  const [hour, minute] = String(value).split(":").map(Number);
  const at = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return at.toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC",
  });
}

/** Stays the hotel's own clock says are over. */
export function overdueStays(bookings, todayIso) {
  return (bookings || []).filter((booking) =>
    booking?.status === "checked_in" && String(booking.check_out) < String(todayIso));
}
