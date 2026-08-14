"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { isOfflineSafe, isPermanentFailure } from "./offline-policy";
import {
  FAILED, PENDING, SENT, failureKind, provisionalArgs, sortProvisionals,
  validateProvisional,
} from "./provisional";

/**
 * Offline support.
 *
 * The honest boundary: reads and low-stakes writes work offline. Creating
 * a booking does NOT get confirmed offline, because two devices with no
 * connection cannot agree on who got room 103. Anything queued here is
 * either idempotent (a cleaning status) or explicitly provisional.
 */

const CACHE_PREFIX = "easyroom:cache:";
const QUEUE_KEY = "easyroom:queue";
const PROVISIONAL_KEY = "easyroom:provisional";

/* ---------------- cache: last known good data ---------------- */

export function cacheWrite(key, data) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ at: Date.now(), data })
    );
  } catch {
    /* storage full or blocked — the app still works, just not offline */
  }
}

export function cacheRead(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function cacheAge(key) {
  const c = cacheRead(key);
  if (!c) return null;
  return Date.now() - c.at;
}

/* ---------------- queue: writes waiting for a connection ---------------- */

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

export function queueAdd(item) {
  if (!isOfflineSafe(item)) throw new Error("This action cannot be queued offline");
  const q = readQueue();
  q.push({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  writeQueue(q);
  window.dispatchEvent(new Event("easyroom:queue"));
  return q.length;
}

export function queueCount() {
  return readQueue().length;
}

export function queueList() {
  return readQueue();
}

export function queueClearOne(id) {
  writeQueue(readQueue().filter((x) => x.id !== id));
  window.dispatchEvent(new Event("easyroom:queue"));
}

/** Everything the queue could not send, with the reason it was refused. */
export function queueStuck() {
  return readQueue().filter((item) => item.error);
}

function markQueued(id, error) {
  writeQueue(readQueue().map((x) => (x.id === id ? { ...x, error } : x)));
}

/**
 * Send everything that's waiting. Order matters, so this stops at the
 * first failure rather than skipping ahead — a check-out queued after a
 * check-in must not overtake it.
 *
 * The reason is written onto the item, not only returned. Stopping in order
 * means one refusal holds up everything behind it, and a queue that jams
 * without saying why is a queue nobody can unjam: the strip counts actions
 * for ever and the cleaning statuses behind them never arrive.
 *
 * Returns { done, failed, errors }.
 */
export async function queueFlush() {
  const q = readQueue();
  if (!q.length) return { done: 0, failed: 0, errors: [] };

  let done = 0;
  const errors = [];

  for (const item of q) {
    try {
      let error = null;

      if (item.kind === "room_status") {
        ({ error } = await supabase.rpc("set_housekeeping_status", {
          p_room: item.room_id,
          p_status: item.status,
        }));
      } else if (item.kind === "rpc") {
        ({ error } = await supabase.rpc(item.fn, item.args));
      } else {
        error = { message: "نوع إجراء غير معروف" };
      }

      if (error) throw error;

      // It went through, so any earlier complaint about it is history.
      queueClearOne(item.id);
      done++;
    } catch (e) {
      const message = String(e?.message || e);
      errors.push({ item, message });
      // A connection that died mid-flush is not a refusal; leave the item
      // clean so the next reconnection simply tries again.
      if (navigator.onLine) {
        markQueued(item.id, { message, permanent: isPermanentFailure({ message }), at: Date.now() });
      }
      break; // preserve order
    }
  }

  return { done, failed: readQueue().length, errors };
}

/* ---------------- provisional bookings ---------------- */

/**
 * Bookings taken with no connection live apart from the ordered queue, and
 * on purpose. The queue stops at its first failure so a check-out cannot
 * overtake the check-in before it — but a booking has no such relationship
 * with anything: nothing already queued can refer to a booking that does not
 * exist yet. If one is refused because the room went to somebody else, it
 * must not hold up the housekeeping statuses behind it.
 */
function readProvisional() {
  try {
    return sortProvisionals(JSON.parse(localStorage.getItem(PROVISIONAL_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeProvisional(list) {
  try {
    localStorage.setItem(PROVISIONAL_KEY, JSON.stringify(list));
  } catch {
    /* storage full — the caller is told by the count not moving */
  }
  window.dispatchEvent(new Event("easyroom:provisional"));
}

export function provisionalList() {
  return readProvisional();
}

export function provisionalAdd(record) {
  const problems = validateProvisional(record);
  if (problems.length) throw new Error(`incomplete provisional booking: ${problems.join(", ")}`);
  const list = readProvisional();
  list.push(record);
  writeProvisional(list);
  return list.length;
}

export function provisionalRemove(id) {
  writeProvisional(readProvisional().filter((r) => r.id !== id));
}

/**
 * How many are still waiting to be sent — and deliberately NOT how many need
 * a human. A refused booking stays on the screen until somebody deals with
 * it, but retrying it on its own would spin forever against a room that is
 * genuinely gone.
 */
export function provisionalCount() {
  return readProvisional().filter((r) => r.state === PENDING).length;
}

/**
 * Send each one on its own. A refusal is kept with its reason rather than
 * dropped, because somebody has to call that guest back — losing the record
 * silently is the one outcome worse than the refusal itself.
 */
export async function provisionalFlush() {
  const waiting = readProvisional().filter((r) => r.state === PENDING);
  if (!waiting.length) return { sent: 0, refused: 0, results: [] };

  const results = [];
  let sent = 0;
  let refused = 0;

  for (const record of waiting) {
    try {
      const { data, error } = await supabase.rpc(
        "create_provisional_booking", provisionalArgs(record)
      );
      if (error) throw error;

      sent++;
      results.push({ id: record.id, ok: true, reference: data?.reference || null });
      // The row is kept, marked, so reception sees what landed while they
      // were not looking. They dismiss it themselves.
      patch(record.id, { state: SENT, error: null, reference: data?.reference || null });
    } catch (e) {
      // A dropped connection mid-send is not a refusal: leave it pending so
      // the next reconnection tries again. The client reference makes that
      // safe even if the request had actually arrived.
      if (!navigator.onLine) break;
      refused++;
      const kind = failureKind(e);
      results.push({ id: record.id, ok: false, kind, message: String(e?.message || e) });
      patch(record.id, { state: FAILED, error: { kind, message: String(e?.message || e) } });
    }
  }

  return { sent, refused, results };

  function patch(id, fields) {
    writeProvisional(readProvisional().map((r) => (r.id === id ? { ...r, ...fields } : r)));
  }
}

/** Try a refused one again — after the room was freed, or another chosen. */
export function provisionalRetry(id, changes = {}) {
  writeProvisional(readProvisional().map((r) =>
    (r.id === id ? { ...r, ...changes, state: PENDING, error: null } : r)
  ));
}

/* ---------------- hook ---------------- */

export function useOffline() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [provisional, setProvisional] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(queueCount());
    setProvisional(provisionalCount());

    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const q = () => setPending(queueCount());
    const p = () => setProvisional(provisionalCount());

    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("easyroom:queue", q);
    window.addEventListener("easyroom:provisional", p);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("easyroom:queue", q);
      window.removeEventListener("easyroom:provisional", p);
    };
  }, []);

  // The guard is a ref, not the state: if `sync` changed identity every time
  // it ran, the effect below would fire again on every completion and retry
  // for ever against something that is never going to succeed.
  const running = useRef(false);
  const sync = useCallback(async () => {
    if (!navigator.onLine || running.current) return null;
    running.current = true;
    setSyncing(true);
    try {
      const res = await queueFlush();
      // Bookings go after the queue, so a check-out queued earlier is not
      // sitting behind a stranger's stay.
      const bookings = await provisionalFlush();
      return { ...res, bookings };
    } finally {
      setPending(queueCount());
      setProvisional(provisionalCount());
      running.current = false;
      setSyncing(false);
    }
  }, []);

  // Drain automatically the moment the connection comes back.
  useEffect(() => {
    if (online && (pending > 0 || provisional > 0)) sync();
  }, [online, pending, provisional, sync]);

  return { online, pending, provisional, syncing, sync };
}

/**
 * Load through the cache: try the network, fall back to what we stored.
 * `fetcher` must return { data, error } the way supabase-js does.
 */
export async function loadCached(key, fetcher) {
  if (navigator.onLine) {
    try {
      const { data, error } = await fetcher();
      if (!error && data) {
        cacheWrite(key, data);
        return { data, error: null, stale: false };
      }
    } catch {
      /* fall through to cache */
    }
  }
  const c = cacheRead(key);
  if (c) return { data: c.data, error: null, stale: true, at: c.at };
  return { data: null, error: { message: "لا توجد نسخة محفوظة" }, stale: false };
}
