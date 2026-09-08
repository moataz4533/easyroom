import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT, clockLabel, hotelHours, hoursProblem,
  isTime, overdueStays,
} from "../lib/hotel-hours";

describe("hotelHours", () => {
  it("reads the hours the hotel set", () => {
    const hours = hotelHours({ settings: { check_in_time: "15:00", check_out_time: "11:00" } });
    expect(hours).toEqual({ checkIn: "15:00", checkOut: "11:00", autoClose: true });
  });

  it("falls back to the hours almost every hotel uses", () => {
    expect(hotelHours({}).checkIn).toBe(DEFAULT_CHECK_IN);
    expect(hotelHours(null).checkOut).toBe(DEFAULT_CHECK_OUT);
  });

  it("ignores a time that is not one", () => {
    const hours = hotelHours({ settings: { check_in_time: "afternoon", check_out_time: "25:00" } });
    expect(hours.checkIn).toBe(DEFAULT_CHECK_IN);
    expect(hours.checkOut).toBe(DEFAULT_CHECK_OUT);
  });

  it("closes stays automatically unless the hotel turned it off", () => {
    expect(hotelHours({ settings: {} }).autoClose).toBe(true);
    expect(hotelHours({ settings: { auto_close_stays: false } }).autoClose).toBe(false);
    expect(hotelHours({ settings: { auto_close_stays: true } }).autoClose).toBe(true);
  });
});

describe("isTime and hoursProblem", () => {
  it("accepts a 24-hour clock and nothing else", () => {
    expect(isTime("00:00")).toBe(true);
    expect(isTime("23:59")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("9:00")).toBe(false);
    expect(isTime("")).toBe(false);
  });

  it("names which of the two is wrong", () => {
    expect(hoursProblem({ checkIn: "14:00", checkOut: "12:00" })).toBe(null);
    expect(hoursProblem({ checkIn: "2pm", checkOut: "12:00" })).toBe("badCheckInTime");
    expect(hoursProblem({ checkIn: "14:00", checkOut: "noon" })).toBe("badCheckOutTime");
  });

  // Departure before arrival is normal here: check-out at noon, check-in at
  // two. The pair is not a stay, it is a daily rhythm.
  it("accepts a departure hour earlier than the arrival hour", () => {
    expect(hoursProblem({ checkIn: "14:00", checkOut: "12:00" })).toBe(null);
  });
});

describe("clockLabel", () => {
  it("writes the hour the way a guest reads it", () => {
    expect(clockLabel("14:00", "en")).toBe("2:00 pm");
    expect(clockLabel("09:30", "en")).toBe("9:30 am");
  });

  it("keeps Western digits in Arabic", () => {
    const label = clockLabel("14:00", "ar");
    expect(label).toContain("2:00");
    expect(label).not.toMatch(/[٠-٩]/);
  });

  it("says nothing rather than something wrong", () => {
    expect(clockLabel("", "en")).toBe("");
    expect(clockLabel("nope", "en")).toBe("");
  });
});

describe("overdueStays", () => {
  const stays = [
    { reference: "A", status: "checked_in", check_out: "2026-09-01" },
    { reference: "B", status: "checked_in", check_out: "2026-09-08" },
    { reference: "C", status: "checked_in", check_out: "2026-09-11" },
    { reference: "D", status: "confirmed", check_out: "2026-09-01" },
    { reference: "E", status: "checked_out", check_out: "2026-09-01" },
  ];

  it("is only stays that are running after their departure day", () => {
    expect(overdueStays(stays, "2026-09-08").map((s) => s.reference)).toEqual(["A"]);
  });

  // A guest at the desk at 12:05 settling their bill is still a guest.
  it("leaves the departure day itself alone", () => {
    expect(overdueStays(stays, "2026-09-08").some((s) => s.reference === "B")).toBe(false);
  });

  it("survives an empty register", () => {
    expect(overdueStays([], "2026-09-08")).toEqual([]);
    expect(overdueStays(null, "2026-09-08")).toEqual([]);
  });
});
