import { describe, expect, it } from "vitest";
import { clashingStays, overlaps, roomsOf, sameGuest } from "../lib/duplicate-booking";

const stay = (over) => ({
  reference: "GR26-0009", status: "confirmed",
  check_in: "2026-08-17", check_out: "2026-08-21",
  guests: { full_name: "عمار الغواص", phone: "01090700714" },
  ...over,
});

describe("whether two stays share a night", () => {
  it("sees an overlap of even one night", () => {
    expect(overlaps(stay(), { checkIn: "2026-08-20", checkOut: "2026-08-23" })).toBe(true);
    expect(overlaps(stay(), { checkIn: "2026-08-15", checkOut: "2026-08-18" })).toBe(true);
    expect(overlaps(stay(), { checkIn: "2026-08-18", checkOut: "2026-08-19" })).toBe(true);
  });

  /** The departure day is not a night: leaving on the 21st and arriving on
   *  the 21st is the room changing hands, not a clash. */
  it("does not count the changeover day", () => {
    expect(overlaps(stay(), { checkIn: "2026-08-21", checkOut: "2026-08-24" })).toBe(false);
    expect(overlaps(stay(), { checkIn: "2026-08-14", checkOut: "2026-08-17" })).toBe(false);
  });
});

describe("whether a booking belongs to the guest being typed", () => {
  it("matches on the name, through the spellings", () => {
    expect(sameGuest(stay(), { name: "عمار الغواص", phone: "" })).toBe(true);
    expect(sameGuest(stay(), { name: " عمارالغواص ", phone: "" })).toBe(true);
  });

  it("matches on the number when the name was typed differently", () => {
    expect(sameGuest(stay(), { name: "شخص تاني", phone: "+201090700714" })).toBe(true);
  });

  it("does not match a different guest", () => {
    expect(sameGuest(stay(), { name: "أحمد محمد", phone: "01000000000" })).toBe(false);
  });
});

describe("the bookings this one would duplicate", () => {
  const ask = { name: "عمار الغواص", phone: "01090700714", checkIn: "2026-08-17", checkOut: "2026-08-21" };

  /** Both of عمار الغواص's bookings are confirmed in the live database, so
   *  a room is being held for a guest who only needs one. */
  it("catches the same guest booked twice for the same nights", () => {
    expect(clashingStays([stay()], ask)).toHaveLength(1);
  });

  it("ignores a booking that no longer holds a room", () => {
    for (const status of ["cancelled", "checked_out", "no_show"]) {
      expect(clashingStays([stay({ status })], ask), status).toEqual([]);
    }
  });

  it("ignores the same guest on different nights", () => {
    expect(clashingStays([stay()], { ...ask, checkIn: "2026-09-01", checkOut: "2026-09-03" }))
      .toEqual([]);
  });

  it("says nothing before there is a guest to say it about", () => {
    expect(clashingStays([stay()], { ...ask, name: "  ", phone: "" })).toEqual([]);
    expect(clashingStays([stay()], { ...ask, checkOut: "" })).toEqual([]);
  });

  it("reads the earliest arrival first", () => {
    const earlier = stay({ reference: "GR26-0001", check_in: "2026-08-15", check_out: "2026-08-19" });
    expect(clashingStays([stay(), earlier], ask).map((s) => s.reference))
      .toEqual(["GR26-0001", "GR26-0009"]);
  });

  it("survives nothing on file", () => {
    expect(clashingStays(null, ask)).toEqual([]);
  });
});

describe("the rooms a clashing stay is holding", () => {
  it("names them, and skips the ones already given back", () => {
    expect(roomsOf({ room_allocations: [
      { released_at: null, rooms: { number: "101" } },
      { released_at: "2026-08-18", rooms: { number: "102" } },
      { released_at: null, rooms: { number: "103" } },
    ] })).toEqual(["101", "103"]);
  });

  it("says nothing when it has nothing", () => {
    expect(roomsOf({})).toEqual([]);
  });
});
