import { describe, expect, it } from "vitest";
import {
  averageStayLength, isReturning, isUnreliable, realStays, sortStays, summariseStays,
} from "../lib/guest-history";

const stays = [
  { id: "1", status: "checked_out", check_in: "2025-11-02", check_out: "2025-11-05", total_amount: 1500, paid_amount: 1500 },
  { id: "2", status: "checked_out", check_in: "2026-03-10", check_out: "2026-03-12", total_amount: 900,  paid_amount: 900 },
  { id: "3", status: "confirmed",   check_in: "2026-08-20", check_out: "2026-08-24", total_amount: 2000, paid_amount: 500 },
  { id: "4", status: "cancelled",   check_in: "2026-05-01", check_out: "2026-05-03", total_amount: 0,    paid_amount: 0 },
  { id: "5", status: "no_show",     check_in: "2026-06-01", check_out: "2026-06-02", total_amount: 400,  paid_amount: 0 },
];

describe("a guest's history at one hotel", () => {
  it("counts visits that happened, not bookings that were made", () => {
    expect(realStays(stays)).toHaveLength(3);
    const summary = summariseStays(stays);
    expect(summary.stays).toBe(3);
    expect(summary.cancelled).toBe(1);
    expect(summary.noShows).toBe(1);
  });

  it("adds up nights, money charged and money paid", () => {
    const summary = summariseStays(stays);
    expect(summary.nights).toBe(9);        // 3 + 2 + 4
    expect(summary.charged).toBe(4400);
    expect(summary.paid).toBe(2900);
    expect(summary.outstanding).toBe(1500);
  });

  it("leaves a cancellation out of the money as well as the count", () => {
    // The no-show's 400 is a charge on a booking, not on a stay.
    expect(summariseStays(stays).charged).not.toBe(4800);
  });

  it("never reports a negative balance when a guest overpaid", () => {
    const overpaid = [{ status: "checked_out", check_in: "2026-01-01", check_out: "2026-01-02", total_amount: 500, paid_amount: 700 }];
    expect(summariseStays(overpaid).outstanding).toBe(0);
  });

  it("finds the first and last visit", () => {
    const summary = summariseStays(stays);
    expect(summary.firstVisit).toBe("2025-11-02");
    expect(summary.lastVisit).toBe("2026-08-20");
  });

  it("returns clean zeroes for someone with no history yet", () => {
    const summary = summariseStays([]);
    expect(summary).toMatchObject({ stays: 0, nights: 0, charged: 0, paid: 0, outstanding: 0 });
    expect(summary.firstVisit).toBeNull();
    expect(summary.lastVisit).toBeNull();
    expect(summariseStays(null).stays).toBe(0);
  });

  it("shows the most recent stay first", () => {
    expect(sortStays(stays).map((stay) => stay.id)).toEqual(["3", "5", "4", "2", "1"]);
  });
});

describe("what reception should be told", () => {
  it("marks a guest who has been here before", () => {
    expect(isReturning(summariseStays(stays))).toBe(true);
    expect(isReturning(summariseStays([stays[0]]))).toBe(false);
    expect(isReturning(summariseStays([]))).toBe(false);
  });

  it("flags a repeat no-show, but not a single one", () => {
    expect(isUnreliable(summariseStays(stays))).toBe(false);
    const twice = [...stays, { status: "no_show", check_in: "2026-07-01", check_out: "2026-07-02" }];
    expect(isUnreliable(summariseStays(twice))).toBe(true);
  });

  it("averages the stay length without dividing by zero", () => {
    expect(averageStayLength(summariseStays(stays))).toBe(3);
    expect(averageStayLength(summariseStays([]))).toBe(0);
  });
});
