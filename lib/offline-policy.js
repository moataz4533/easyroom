const SAFE_KINDS = new Set(["room_status", "rpc"]);
const SAFE_RPCS = new Set([
  "set_housekeeping_status", "check_in_booking", "check_out_booking",
  "move_booking_room", "extend_booking",
]);

export function isOfflineSafe(item) {
  if (!item || !SAFE_KINDS.has(item.kind)) return false;
  if (item.kind === "room_status") return Boolean(item.room_id && item.status);
  return SAFE_RPCS.has(item.fn) && Boolean(item.args);
}
