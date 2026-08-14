import { describe, expect, it } from "vitest";
import { earlyDepartureAmounts, isLeavingEarly } from "../lib/checkout";

// A week in one room at 1200, from the 13th.
const week = ["13", "14", "15", "16", "17", "18", "19"].map((d) => ({
  allocation_id: "a1", night: `2026-08-${d}`, amount: 1200,
}));

// The same week in two rooms.
const twoRooms = [
  ...week,
  ...week.map((n) => ({ ...n, allocation_id: "a2" })),
];

describe("what each choice costs", () => {
  it("bills the nights already behind the guest, and the whole stay the other way", () => {
    expect(earlyDepartureAmounts(week, "2026-08-15")).toMatchObject({
      stayed: 2400, booked: 8400, unstayed: 6000, nightsStayed: 2, nightsBooked: 7,
    });
  });

  it("counts every room on each night", () => {
    expect(earlyDepartureAmounts(twoRooms, "2026-08-15")).toMatchObject({
      stayed: 4800, booked: 16800, unstayed: 12000,
    });
    // Two rooms on one date is still one night of stay, not two.
    expect(earlyDepartureAmounts(twoRooms, "2026-08-15").nightsBooked).toBe(7);
  });

  it("charges the first night to a guest who leaves the morning they arrived", () => {
    // Nothing is behind them yet, but they held the room overnight — which is
    // what the database does with greatest(starts_on + 1, today).
    expect(earlyDepartureAmounts(week, "2026-08-13")).toMatchObject({
      stayed: 1200, booked: 8400, nightsStayed: 1,
    });
    expect(earlyDepartureAmounts(twoRooms, "2026-08-13").stayed).toBe(2400);
  });

  it("has nothing to charge extra when the guest stays to the end", () => {
    expect(earlyDepartureAmounts(week, "2026-08-20")).toMatchObject({
      stayed: 8400, booked: 8400, unstayed: 0,
    });
  });

  it("never reports a negative difference", () => {
    expect(earlyDepartureAmounts(week, "2027-01-01").unstayed).toBe(0);
  });

  it("ignores rows with nothing usable on them instead of pricing them as zero", () => {
    const noisy = [...week, { allocation_id: "a1", night: null, amount: 999 },
      { allocation_id: "a1", night: "2026-08-20", amount: "abc" }];
    expect(earlyDepartureAmounts(noisy, "2026-08-15").booked).toBe(8400);
  });

  it("says nothing rather than guessing when there are no nights at all", () => {
    expect(earlyDepartureAmounts([], "2026-08-15")).toMatchObject({
      stayed: 0, booked: 0, unstayed: 0, nightsStayed: 0, nightsBooked: 0,
    });
    expect(earlyDepartureAmounts(null, "2026-08-15").booked).toBe(0);
  });
});

describe("whether there is a question to ask", () => {
  it("only asks when the booking runs past today", () => {
    expect(isLeavingEarly("2026-08-20", "2026-08-15")).toBe(true);
    expect(isLeavingEarly("2026-08-15", "2026-08-15")).toBe(false);
    expect(isLeavingEarly("2026-08-14", "2026-08-15")).toBe(false);
    expect(isLeavingEarly(null, "2026-08-15")).toBe(false);
  });
});
