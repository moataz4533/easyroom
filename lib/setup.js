/**
 * What is still missing before the hotel can actually run on this.
 *
 * The app knows the answer better than any checklist kept elsewhere: it can
 * see whether rates exist, whether the rooms have real types, whether the
 * manager password is on. So it says so itself, on the screen staff open
 * first, with a link straight to the place that fixes it.
 *
 * Ordered by what blocks real use, not by effort.
 */

// Blocking: bookings are wrong or unprotected until these are done.
// Advisory: the app works, but something it produces will be incomplete.
export const BLOCKING = "blocking";
export const ADVISORY = "advisory";

const DEFAULT_TYPE_NAMES = ["غرفة قياسية", "standard room", "غرفة عادية"];

export function isDefaultType(type) {
  return DEFAULT_TYPE_NAMES.includes(String(type?.name || "").trim().toLowerCase())
    || DEFAULT_TYPE_NAMES.includes(String(type?.name || "").trim());
}

/**
 * `state` is what the dashboard already knows plus three cheap lookups:
 * { rateCount, types, rooms, hasPin, staffCount, settings }
 */
export function outstandingSetup(state) {
  const items = [];
  const settings = state?.settings || {};

  if (!state?.rateCount) {
    items.push({ id: "rates", level: BLOCKING, tab: "rates" });
  }

  const types = state?.types || [];
  if (types.length > 0 && types.every(isDefaultType)) {
    items.push({ id: "roomTypes", level: BLOCKING, tab: "rooms" });
  }

  // With no password every financial guard passes silently — cancelling,
  // taking a line off a bill, changing rates.
  if (!state?.hasPin) {
    items.push({ id: "managerPassword", level: BLOCKING, tab: "security" });
  }

  if (!String(settings.whatsapp_number || "").trim()) {
    items.push({ id: "whatsapp", level: ADVISORY, tab: "property" });
  }

  if (!String(settings.cancellation_policy || "").trim()) {
    items.push({ id: "policy", level: ADVISORY, tab: "property" });
  }

  if ((state?.staffCount ?? 0) <= 1) {
    items.push({ id: "staff", level: ADVISORY, tab: "staff" });
  }

  return items;
}

export function isReadyToOperate(state) {
  return outstandingSetup(state).every((item) => item.level !== BLOCKING);
}

export function countByLevel(items) {
  return {
    blocking: (items || []).filter((item) => item.level === BLOCKING).length,
    advisory: (items || []).filter((item) => item.level === ADVISORY).length,
  };
}
