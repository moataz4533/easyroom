import { describe, expect, it } from "vitest";
import {
  awaitingCheckIn, editChanges, editForm, editProblem, maxOccupancy, stayStarted,
} from "../lib/booking-edit";

const booking = {
  check_in: "2026-08-14",
  check_out: "2026-08-18",
  status: "confirmed",
  notes: "وصول متأخر",
  guests: { full_name: "احمد محمد", phone: "01090700714" },
};

const allocations = [
  { id: "a1", occupancy: 2, rooms: { number: "101", room_types: { max_occupancy: 4 } } },
  { id: "a2", occupancy: 3, rooms: { number: "102", room_types: { max_occupancy: 4 } } },
];

describe("the form as it opens", () => {
  it("shows what the booking already says", () => {
    expect(editForm(booking, allocations)).toEqual({
      full_name: "احمد محمد",
      phone: "01090700714",
      notes: "وصول متأخر",
      occupancy: { a1: 2, a2: 3 },
    });
  });

  it("survives a booking with nothing filled in", () => {
    expect(editForm({}, [])).toEqual({ full_name: "", phone: "", notes: "", occupancy: {} });
    expect(editForm(null, null).occupancy).toEqual({});
  });
});

describe("what a room may hold", () => {
  it("reads the cap off the room type", () => {
    expect(maxOccupancy(allocations[0])).toBe(4);
  });

  it("falls back to what is already booked rather than inventing a limit", () => {
    // A missing join must never make a stay that exists look invalid.
    expect(maxOccupancy({ occupancy: 3 })).toBe(3);
    expect(maxOccupancy({})).toBe(1);
  });
});

describe("what the desk is stopped from saving", () => {
  const form = editForm(booking, allocations);

  it("accepts the booking unchanged", () => {
    expect(editProblem(form, allocations)).toBeNull();
  });

  it("insists on a guest name", () => {
    expect(editProblem({ ...form, full_name: "  " }, allocations)).toBe("needGuestName");
  });

  it("refuses a room with nobody in it", () => {
    expect(editProblem({ ...form, occupancy: { a1: 0, a2: 3 } }, allocations)).toBe("needPax");
    expect(editProblem({ ...form, occupancy: { a1: "", a2: 3 } }, allocations)).toBe("needPax");
  });

  it("refuses more people than the room takes", () => {
    expect(editProblem({ ...form, occupancy: { a1: 5, a2: 3 } }, allocations)).toBe("tooManyPax");
    expect(editProblem({ ...form, occupancy: { a1: 4, a2: 4 } }, allocations)).toBeNull();
  });
});

describe("what actually gets written", () => {
  const form = editForm(booking, allocations);

  it("writes nothing when nothing changed", () => {
    expect(editChanges(form, booking, allocations)).toEqual({
      guest: null, booking: null, rooms: [], any: false,
    });
  });

  it("writes only the guest when only the name changed", () => {
    const changes = editChanges({ ...form, full_name: "أحمد محمد رمضان" }, booking, allocations);
    expect(changes).toMatchObject({ guest: { full_name: "أحمد محمد رمضان" }, booking: null, rooms: [], any: true });
  });

  /**
   * The one that matters: occupancy is half of what a room costs, and
   * changing it rewrites that room's nights. An edit to a note must not
   * touch it.
   */
  it("writes only the room whose head count moved", () => {
    const changes = editChanges({ ...form, occupancy: { a1: 3, a2: 3 } }, booking, allocations);
    expect(changes.rooms).toEqual([{ id: "a1", occupancy: 3 }]);
    expect(changes.guest).toBeNull();
  });

  it("clears a note and a phone to null rather than to an empty string", () => {
    const changes = editChanges({ ...form, notes: "", phone: "" }, booking, allocations);
    expect(changes.booking).toEqual({ notes: null });
    expect(changes.guest).toEqual({ phone: null });
  });

  it("does not count a change that is only whitespace", () => {
    expect(editChanges({ ...form, full_name: " احمد محمد " }, booking, allocations).any).toBe(false);
  });
});

/**
 * The reason reception was left with "cancel the whole booking": early
 * departure was offered only for a booking marked checked-in, and a booking
 * entered after the guest arrived never gets marked.
 */
describe("whether the stay has begun", () => {
  it("is true from the arrival day onward, whatever the status says", () => {
    expect(stayStarted(booking, "2026-08-14")).toBe(true);
    expect(stayStarted(booking, "2026-08-16")).toBe(true);
  });

  it("is false before the guest is due", () => {
    expect(stayStarted(booking, "2026-08-13")).toBe(false);
  });

  it("does not guess when it has no dates", () => {
    expect(stayStarted({}, "2026-08-16")).toBe(false);
    expect(stayStarted(booking, null)).toBe(false);
  });
});

describe("bookings the arrivals list misses", () => {
  it("catches a guest in the room whom nobody checked in", () => {
    expect(awaitingCheckIn(booking, "2026-08-16")).toBe(true);
  });

  it("leaves alone a booking that is already checked in", () => {
    expect(awaitingCheckIn({ ...booking, status: "checked_in" }, "2026-08-16")).toBe(false);
  });

  it("leaves alone a stay that has not started or has finished", () => {
    expect(awaitingCheckIn(booking, "2026-08-13")).toBe(false);
    expect(awaitingCheckIn(booking, "2026-08-18")).toBe(false);
  });
});
