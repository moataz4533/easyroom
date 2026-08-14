import { describe, expect, it } from "vitest";
import {
  buildWindow, clipAllocation, isWeekend, movementsByDay,
  occupancyByDay, segmentsByRoom, windowRange,
} from "../lib/calendar";

const days = buildWindow("2026-08-10", 7); // 10 → 16 August

const stay = (over) => ({
  id: "a", room_id: "r1", kind: "booking",
  starts_on: "2026-08-11", ends_on: "2026-08-14", ...over,
});

describe("tape chart window", () => {
  it("builds consecutive days and a half-open range", () => {
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-10");
    expect(days[6]).toBe("2026-08-16");
    expect(windowRange(days)).toEqual({ start: "2026-08-10", end: "2026-08-17" });
  });

  it("crosses a month boundary without losing a day", () => {
    expect(buildWindow("2026-08-30", 3)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("marks Friday and Saturday as the weekend", () => {
    expect(isWeekend("2026-08-14")).toBe(true);  // Friday
    expect(isWeekend("2026-08-15")).toBe(true);  // Saturday
    expect(isWeekend("2026-08-16")).toBe(false); // Sunday
  });
});

describe("placing a stay on the grid", () => {
  it("paints the nights slept, not the checkout morning", () => {
    const segment = clipAllocation(stay(), days);
    expect(segment.offset).toBe(1);
    expect(segment.span).toBe(3); // 11, 12, 13 — the guest leaves on the 14th
    expect(segment.continuesBefore).toBe(false);
    expect(segment.continuesAfter).toBe(false);
  });

  it("cuts a stay that started before the window and flags it", () => {
    const segment = clipAllocation(stay({ starts_on: "2026-07-28", ends_on: "2026-08-12" }), days);
    expect(segment.offset).toBe(0);
    expect(segment.span).toBe(2);
    expect(segment.continuesBefore).toBe(true);
    expect(segment.continuesAfter).toBe(false);
  });

  it("cuts a stay that runs past the window and flags it", () => {
    const segment = clipAllocation(stay({ starts_on: "2026-08-15", ends_on: "2026-09-04" }), days);
    expect(segment.offset).toBe(5);
    expect(segment.span).toBe(2);
    expect(segment.continuesAfter).toBe(true);
  });

  it("covers the whole window when the stay swallows it", () => {
    const segment = clipAllocation(stay({ starts_on: "2026-01-01", ends_on: "2027-01-01" }), days);
    expect(segment.offset).toBe(0);
    expect(segment.span).toBe(7);
    expect(segment.continuesBefore && segment.continuesAfter).toBe(true);
  });

  it("drops stays that never touch the window", () => {
    expect(clipAllocation(stay({ starts_on: "2026-09-01", ends_on: "2026-09-03" }), days)).toBeNull();
    expect(clipAllocation(stay({ starts_on: "2026-08-01", ends_on: "2026-08-10" }), days)).toBeNull();
    // Ends exactly on the first shown day: that morning belongs to the next guest.
  });

  it("groups by room and keeps each row in date order", () => {
    const rows = segmentsByRoom([
      stay({ id: "late", starts_on: "2026-08-14", ends_on: "2026-08-16" }),
      stay({ id: "early" }),
      stay({ id: "other-room", room_id: "r2" }),
      stay({ id: "gone", starts_on: "2026-06-01", ends_on: "2026-06-05" }),
    ], days);

    expect([...rows.keys()]).toEqual(["r1", "r2"]);
    expect(rows.get("r1").map((s) => s.id)).toEqual(["early", "late"]);
    expect(rows.get("r2")).toHaveLength(1);
  });
});

describe("occupancy per night", () => {
  const rooms = 4;
  const allocations = [
    stay({ id: "1", room_id: "r1" }),
    stay({ id: "2", room_id: "r2", starts_on: "2026-08-12", ends_on: "2026-08-13" }),
    stay({ id: "3", room_id: "r3", kind: "maintenance", booking_id: null,
      starts_on: "2026-08-10", ends_on: "2026-08-20" }),
  ];

  it("counts guests and out-of-service rooms apart", () => {
    const byDay = occupancyByDay(allocations, days, rooms);
    const twelfth = byDay.find((d) => d.date === "2026-08-12");
    expect(twelfth.occupied).toBe(2);
    expect(twelfth.blocked).toBe(1);
    expect(twelfth.free).toBe(1);
  });

  it("measures the rate against sellable rooms, not blocked ones", () => {
    const byDay = occupancyByDay(allocations, days, rooms);
    // 11 August: one guest, one room out of service → 1 of 3 sellable.
    expect(byDay.find((d) => d.date === "2026-08-11").rate).toBeCloseTo(1 / 3);
    // 15 August: nobody in, still one room out of service.
    expect(byDay.find((d) => d.date === "2026-08-15")).toMatchObject({ occupied: 0, free: 3, rate: 0 });
  });

  it("never divides by zero on a property with no rooms", () => {
    expect(occupancyByDay([], days, 0)[0].rate).toBe(0);
  });
});

describe("arrivals and departures per night", () => {
  it("counts guest movements only, inside the window", () => {
    const byDay = movementsByDay([
      stay({ id: "1" }),                                   // in 11, out 14
      stay({ id: "2", room_id: "r2" }),                    // in 11, out 14
      stay({ id: "3", room_id: "r3", kind: "maintenance", booking_id: null,
        starts_on: "2026-08-11", ends_on: "2026-08-12" }), // not a guest
      stay({ id: "4", room_id: "r4", starts_on: "2026-08-01", ends_on: "2026-08-30" }),
    ], days);

    expect(byDay.find((d) => d.date === "2026-08-11")).toMatchObject({ arrivals: 2, departures: 0 });
    expect(byDay.find((d) => d.date === "2026-08-14")).toMatchObject({ arrivals: 0, departures: 2 });
    // The long stay starts and ends outside the window, so it moves nothing here.
    expect(byDay.reduce((total, d) => total + d.arrivals, 0)).toBe(2);
  });
});
