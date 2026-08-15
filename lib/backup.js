/**
 * The hotel's own copy of itself.
 *
 * On the free plan the database has no backups, so the only copy of the
 * bookings and the guest register is the one live database. Until that is
 * paid for, this puts a copy on the manager's device — which is a real
 * safety net for the loss that actually happens to small hotels (a mistake,
 * a deletion, an account problem), and no help at all against forgetting to
 * take one. So the app remembers when the last was taken and says so.
 */

export const STALE_AFTER_DAYS = 7;
export const LAST_BACKUP_KEY = "easyroom:last-backup";

/** What is in the file, in the order it is worth reading. */
export const BACKUP_TABLES = [
  "rooms", "guests", "bookings", "room_allocations",
  "payments", "booking_charges", "rates", "rate_seasons",
];

export function isBackup(file) {
  return Boolean(file) && file.format === "easyroom-backup" && Boolean(file.data);
}

/** How many rows of each kind came back, for the screen to show. */
export function summarise(file) {
  if (!isBackup(file)) return null;
  const counts = {};
  for (const table of BACKUP_TABLES) {
    counts[table] = Array.isArray(file.data[table]) ? file.data[table].length : 0;
  }
  return counts;
}

/**
 * A file with no bookings in it is not a backup worth keeping, and saving one
 * would be worse than saving nothing: it would reset the reminder and leave
 * the hotel believing it is covered.
 */
export function problemWith(file) {
  if (!isBackup(file)) return "notBackup";
  const counts = summarise(file);
  if (counts.rooms === 0) return "empty";
  return null;
}

export function backupFileName(hotel, takenAt = new Date()) {
  const clean = String(hotel || "hotel").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
  const stamp = new Date(takenAt).toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  return `${clean} backup ${stamp}.json`;
}

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now - then) / 86400000);
}

/** Whether the screen should be asking for a new one. */
export function isStale(iso, now = Date.now()) {
  const days = daysSince(iso, now);
  return days === null || days >= STALE_AFTER_DAYS;
}
