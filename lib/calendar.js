import { daysBetween, shiftDate } from "./format";

/**
 * Tape chart maths — rooms are rows, days are columns.
 *
 * Deliberately free of React and Supabase: the layout is where a calendar
 * screen goes wrong (a stay drawn one column off is a wrong answer given
 * confidently), so it has to be testable on its own.
 *
 * Every range here is half-open [starts_on, ends_on) exactly like the
 * `daterange` in the database: the checkout morning belongs to the next
 * guest, so it is not painted.
 */

export const WINDOW_LENGTHS = [7, 14, 30];
export const DEFAULT_WINDOW = 14;

export function buildWindow(startIso, length = DEFAULT_WINDOW) {
  return Array.from({ length }, (_, index) => shiftDate(startIso, index));
}

export function windowRange(days) {
  return { start: days[0], end: shiftDate(days[days.length - 1], 1) };
}

/**
 * Places one allocation on the visible grid, cutting whatever falls outside
 * it. A stay that started last month still has to be drawn — from the left
 * edge, flagged so the bar can show it runs on.
 */
export function clipAllocation(allocation, days) {
  const { start, end } = windowRange(days);
  if (allocation.starts_on >= end || allocation.ends_on <= start) return null;

  const offset = Math.max(0, daysBetween(start, allocation.starts_on));
  const finish = Math.min(days.length, daysBetween(start, allocation.ends_on));
  if (finish <= offset) return null;

  return {
    ...allocation,
    offset,
    span: finish - offset,
    continuesBefore: allocation.starts_on < start,
    continuesAfter: allocation.ends_on > end,
  };
}

export function segmentsByRoom(allocations, days) {
  const byRoom = new Map();
  for (const allocation of allocations || []) {
    const segment = clipAllocation(allocation, days);
    if (!segment) continue;
    const list = byRoom.get(allocation.room_id) || [];
    list.push(segment);
    byRoom.set(allocation.room_id, list);
  }
  for (const list of byRoom.values()) list.sort((a, b) => a.offset - b.offset);
  return byRoom;
}

export function coversDay(allocation, day) {
  return allocation.starts_on <= day && allocation.ends_on > day;
}

/**
 * Occupancy per column. Maintenance and holds are counted apart from guests:
 * a room out of service is neither sold nor sellable, and rolling the two
 * together would quietly inflate the occupancy rate.
 */
export function occupancyByDay(allocations, days, roomCount) {
  return days.map((day) => {
    let occupied = 0;
    let blocked = 0;
    for (const allocation of allocations || []) {
      if (!coversDay(allocation, day)) continue;
      if (allocation.kind === "booking") occupied += 1;
      else blocked += 1;
    }
    const sellable = Math.max(0, roomCount - blocked);
    return {
      date: day,
      occupied,
      blocked,
      free: Math.max(0, sellable - occupied),
      rate: sellable ? occupied / sellable : 0,
    };
  });
}

export function movementsByDay(allocations, days) {
  const { start, end } = windowRange(days);
  const arrivals = new Map();
  const departures = new Map();
  for (const allocation of allocations || []) {
    if (allocation.kind !== "booking") continue;
    if (allocation.starts_on >= start && allocation.starts_on < end) {
      arrivals.set(allocation.starts_on, (arrivals.get(allocation.starts_on) || 0) + 1);
    }
    if (allocation.ends_on >= start && allocation.ends_on < end) {
      departures.set(allocation.ends_on, (departures.get(allocation.ends_on) || 0) + 1);
    }
  }
  return days.map((day) => ({
    date: day,
    arrivals: arrivals.get(day) || 0,
    departures: departures.get(day) || 0,
  }));
}

/** Friday and Saturday — the Egyptian weekend, not the European one. */
export function isWeekend(iso) {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return weekday === 5 || weekday === 6;
}
