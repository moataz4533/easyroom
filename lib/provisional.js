/**
 * A booking taken while the connection is down.
 *
 * The important thing this file gets right is that it is NOT a booking.
 * Nothing is held: a room is only reserved once the request reaches the
 * database, and until then the same room can go to somebody else — from
 * another device, or from the phone line. So it is recorded as provisional,
 * shown as provisional, and becomes a real booking only when it lands.
 *
 * Everything here is pure. The storage and the network live in lib/offline.js,
 * because the part worth testing is the part that decides whether a stay can
 * be promised at all.
 */

export const PENDING = "pending";   // waiting for a connection
export const FAILED = "failed";     // the database refused it; somebody must act
export const SENT = "sent";         // it landed, and reception has not read that yet

/* ---------------- building one ---------------- */

export function newProvisional(draft, { now = Date.now(), id } = {}) {
  return {
    id: id || `${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    state: PENDING,
    error: null,
    propertyId: draft?.propertyId || null,
    guestName: String(draft?.guestName || "").trim(),
    guestPhone: String(draft?.guestPhone || "").trim(),
    checkIn: draft?.checkIn || null,
    checkOut: draft?.checkOut || null,
    // { room_id: occupancy }, the same shape the booking screen already holds.
    rooms: { ...(draft?.rooms || {}) },
    // The room numbers as reception saw them. Kept on the record because a
    // provisional booking has to be readable with no connection to look them
    // up, which is the only situation it exists in.
    roomLabels: { ...(draft?.roomLabels || {}) },
    ratePlanId: draft?.ratePlanId || null,
    source: draft?.source || "phone",
    notes: String(draft?.notes || "").trim(),
  };
}

/**
 * Reasons this cannot be recorded at all, as codes the screen translates.
 * A provisional booking with no guest name is worthless when it fails —
 * nobody knows who to call back.
 */
export function validateProvisional(record) {
  const problems = [];
  if (!record?.guestName) problems.push("name");
  if (!record?.propertyId) problems.push("property");
  if (!roomIds(record).length) problems.push("rooms");
  if (!record?.checkIn || !record?.checkOut || record.checkOut <= record.checkIn) {
    problems.push("dates");
  }
  return problems;
}

export function roomIds(record) {
  return Object.keys(record?.rooms || {});
}

export function roomNumbers(record) {
  return roomIds(record).map((id) => record?.roomLabels?.[id] || id);
}

export function headCount(record) {
  return Object.values(record?.rooms || {}).reduce((a, b) => a + Number(b || 0), 0);
}

/* ---------------- what we can already tell will fail ---------------- */

// Half-open, like the daterange in the database: the checkout morning
// belongs to the next guest, so it is not an overlap.
export function overlaps(a, b) {
  if (!a?.checkIn || !a?.checkOut || !b?.checkIn || !b?.checkOut) return false;
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}

/**
 * Other provisional bookings on this device that want the same room on the
 * same nights. These are not a guess: when the connection returns, one of
 * them will be refused. Saying so now is the whole point of writing it down.
 */
export function conflictingProvisionals(record, others) {
  const mine = new Set(roomIds(record));
  return (others || []).filter((other) =>
    other.id !== record?.id
    && other.state !== SENT
    && overlaps(record, other)
    && roomIds(other).some((id) => mine.has(id))
  );
}

/**
 * Rooms already spoken for by another provisional booking over these nights.
 * Unlike the saved copy below, this is certain: both cannot be honoured.
 */
export function roomsWantedByDrafts(drafts, checkIn, checkOut, exceptId = null) {
  const wanted = new Set();
  const window = { checkIn, checkOut };
  for (const draft of drafts || []) {
    if (draft.id === exceptId || draft.state === SENT) continue;
    if (!overlaps(window, draft)) continue;
    for (const id of roomIds(draft)) wanted.add(id);
  }
  return wanted;
}

/**
 * Rooms the last data we managed to save says are taken over these nights.
 * That data may be out of date — a stay may have been cancelled since — so
 * this marks a room, it does not forbid it.
 */
export function roomsHeldOn(allocations, checkIn, checkOut) {
  const held = new Set();
  if (!checkIn || !checkOut || checkOut <= checkIn) return held;
  for (const a of allocations || []) {
    if (!a?.room_id || !a.starts_on || !a.ends_on) continue;
    if (a.starts_on < checkOut && checkIn < a.ends_on) held.add(a.room_id);
  }
  return held;
}

/* ---------------- sending it ---------------- */

export function provisionalArgs(record) {
  return {
    p_property: record.propertyId,
    // The device keeps one reference per provisional booking, so a request
    // that succeeded but whose answer never arrived is not sent twice.
    p_client_ref: record.id,
    p_guest_name: record.guestName,
    p_guest_phone: record.guestPhone || null,
    p_check_in: record.checkIn,
    p_check_out: record.checkOut,
    p_rooms: Object.entries(record.rooms).map(([room_id, occupancy]) => ({
      room_id, occupancy: Number(occupancy) || 2,
    })),
    p_rate_plan: record.ratePlanId || null,
    p_source: record.source || "phone",
    p_notes: record.notes || null,
  };
}

/**
 * Why it was refused, in the terms reception needs: a room that went to
 * somebody else is a different problem from a password one.
 */
export function failureKind(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (code === "23P01" || /exclusion|overlap/i.test(message)) return "taken";
  if (code === "42501" || /not authorised/i.test(message)) return "unauthorised";
  if (/rate plan/i.test(message)) return "noRatePlan";
  return "other";
}

// Oldest first: the guest who called first should get the room.
export function sortProvisionals(list) {
  return [...(list || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function countByState(list) {
  const out = { pending: 0, failed: 0, sent: 0 };
  for (const r of list || []) {
    if (r.state === FAILED) out.failed++;
    else if (r.state === SENT) out.sent++;
    else out.pending++;
  }
  return out;
}

// What the banner has to shout about: a refusal needs somebody to call the
// guest back, and a stay still waiting is not yet a promise the hotel can keep.
export function needsAttention(list) {
  const { failed, pending } = countByState(list);
  return failed + pending;
}
