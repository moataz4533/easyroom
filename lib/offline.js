"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import { isOfflineSafe } from "./offline-policy";

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

/**
 * Send everything that's waiting. Order matters, so this stops at the
 * first failure rather than skipping ahead — a check-out queued after a
 * check-in must not overtake it.
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

      if (error) {
        errors.push({ item, message: error.message });
        break; // preserve order
      }

      queueClearOne(item.id);
      done++;
    } catch (e) {
      errors.push({ item, message: String(e?.message || e) });
      break;
    }
  }

  return { done, failed: readQueue().length, errors };
}

/* ---------------- hook ---------------- */

export function useOffline() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(queueCount());

    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const q = () => setPending(queueCount());

    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("easyroom:queue", q);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("easyroom:queue", q);
    };
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine || syncing) return null;
    setSyncing(true);
    const res = await queueFlush();
    setPending(queueCount());
    setSyncing(false);
    return res;
  }, [syncing]);

  // Drain automatically the moment the connection comes back.
  useEffect(() => {
    if (online && pending > 0) sync();
  }, [online, pending, sync]);

  return { online, pending, syncing, sync };
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
  return { data: null, error: { message: "مفيش نسخة محفوظة" }, stale: false };
}
