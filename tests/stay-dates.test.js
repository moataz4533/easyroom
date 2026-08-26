import { describe, expect, it } from "vitest";
import { datesChange, datesForm, datesProblem, nightOptions } from "../lib/stay-dates";

const booking = { check_in: "2026-08-24", check_out: "2026-08-25", status: "confirmed" };

describe("the form as it opens", () => {
  it("shows the dates the booking already has", () => {
    expect(datesForm(booking)).toEqual({ check_in: "2026-08-24", check_out: "2026-08-25" });
  });

  it("survives a booking with no dates", () => {
    expect(datesForm(null)).toEqual({ check_in: "", check_out: "" });
  });
});

describe("what reception may ask for", () => {
  /**
   * The case this whole thing exists for: GR26-0015 was 24→25 and the guest
   * stayed to the 27th. It was entered as a second booking and one of them
   * was cancelled.
   */
  it("allows the departure to move later", () => {
    expect(datesProblem({ check_in: "2026-08-24", check_out: "2026-08-27" }, booking)).toBeNull();
  });

  it("allows the whole stay to move", () => {
    expect(datesProblem({ check_in: "2026-08-26", check_out: "2026-08-28" }, booking)).toBeNull();
  });

  it("refuses a departure on or before the arrival", () => {
    expect(datesProblem({ check_in: "2026-08-24", check_out: "2026-08-24" }, booking))
      .toBe("checkOutAfterCheckIn");
    expect(datesProblem({ check_in: "2026-08-24", check_out: "2026-08-23" }, booking))
      .toBe("checkOutAfterCheckIn");
  });

  it("refuses a save that changes nothing", () => {
    expect(datesProblem(datesForm(booking), booking)).toBe("datesUnchanged");
  });

  it("wants both dates", () => {
    expect(datesProblem({ check_in: "2026-08-24", check_out: "" }, booking)).toBe("needBothDates");
  });

  /** A guest standing in the room did not arrive on a different day. */
  it("holds the arrival still once the guest is in", () => {
    const resident = { ...booking, status: "checked_in" };
    expect(datesProblem({ check_in: "2026-08-25", check_out: "2026-08-27" }, resident))
      .toBe("guestAlreadyIn");
    // ...but they can still stay longer.
    expect(datesProblem({ check_in: "2026-08-24", check_out: "2026-08-27" }, resident)).toBeNull();
  });
});

describe("what the change amounts to", () => {
  it("counts the nights either side", () => {
    expect(datesChange({ check_in: "2026-08-24", check_out: "2026-08-27" }, booking))
      .toMatchObject({ was: 1, now: 3, delta: 2, longer: true, shorter: false, moved: false });
  });

  /** Shorter means money comes off, which is why the password box appears. */
  it("knows when a stay is losing nights", () => {
    const four = { check_in: "2026-08-24", check_out: "2026-08-28", status: "confirmed" };
    expect(datesChange({ check_in: "2026-08-24", check_out: "2026-08-26" }, four))
      .toMatchObject({ delta: -2, shorter: true });
  });

  it("sees a stay of the same length on different days as a move", () => {
    expect(datesChange({ check_in: "2026-08-26", check_out: "2026-08-27" }, booking))
      .toMatchObject({ delta: 0, shorter: false, longer: false, moved: true });
  });
});

describe("the nights shortcuts", () => {
  it("counts forward from the arrival this booking already has", () => {
    expect(nightOptions("2026-08-24", [1, 3])).toEqual([
      { nights: 1, date: "2026-08-25" },
      { nights: 3, date: "2026-08-27" },
    ]);
  });

  it("crosses a month end without arithmetic of its own", () => {
    expect(nightOptions("2026-08-30", [3])).toEqual([{ nights: 3, date: "2026-09-02" }]);
  });

  it("offers nothing when there is no arrival to count from", () => {
    expect(nightOptions("")).toEqual([]);
  });
});
