/**
 * What may be queued while there is no connection, and what each queued
 * thing is called when it has to be explained to whoever is standing at
 * the desk.
 *
 * The list is short on purpose. Everything on it either does not care how
 * many times it runs (a cleaning status) or acts on a booking that already
 * exists, so replaying it later cannot invent anything. Taking a booking is
 * not on it — that goes through the provisional path in lib/provisional.js,
 * which is explicit about holding nothing.
 */

const SAFE_KINDS = new Set(["room_status", "rpc"]);

// Every name here must be a function that exists. An allowlist that permits
// a call the database has never heard of only queues a certain failure.
const SAFE_RPCS = new Set([
  "set_housekeeping_status", "check_in_booking", "check_out_booking",
]);

export function isOfflineSafe(item) {
  if (!item || !SAFE_KINDS.has(item.kind)) return false;
  if (item.kind === "room_status") return Boolean(item.room_id && item.status);
  return SAFE_RPCS.has(item.fn) && Boolean(item.args);
}

const LABELS = {
  room_status: "housekeeping",
  set_housekeeping_status: "housekeeping",
  check_in_booking: "checkIn",
  check_out_booking: "checkOut",
};

/** A message key for what this queued action was, in reception's words. */
export function describeQueued(item) {
  if (!item) return "unknown";
  return LABELS[item.kind === "room_status" ? "room_status" : item.fn] || "unknown";
}

/**
 * Whether a queued action failed for a reason that trying again will fix.
 * A booking that has been cancelled or already checked out will refuse for
 * ever, and a queue that retries it for ever never sends anything behind it.
 */
export function isPermanentFailure(error) {
  const message = String(error?.message || "");
  if (!message) return false;
  return /already|not found|does not exist|cancelled|not authorised|42501|PGRST202/i.test(message);
}
