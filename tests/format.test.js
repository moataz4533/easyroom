import { describe, expect, it } from "vitest";
import { countNights, formatCurrency, formatDate, fullDate, totalQuote } from "../lib/format";
import { addDays } from "../lib/supabase";

describe("localized hotel formatting", () => {
  it("formats EGP using the selected locale", () => {
    expect(formatCurrency(1250, "en")).toMatch(/1,250/);
    expect(formatCurrency(1250, "ar")).toContain("١");
  });
  it("formats the same date in both locales", () => {
    expect(formatDate("2026-08-13", "en")).toMatch(/13/);
    expect(formatDate("2026-08-13", "ar")).toContain("١٣");
  });
  it("calculates nights and quote totals", () => {
    expect(countNights("2026-08-13", "2026-08-16")).toBe(3);
    expect(totalQuote([{ amount: 1200 }, { amount: "850" }, { amount: null }])).toBe(2050);
  });
  it("adds hotel calendar days without shifting in Cairo timezone", () => {
    expect(addDays("2026-08-13", 1)).toBe("2026-08-14");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("dates that are not plain days", () => {
  it("reads the day off a full timestamp", () => {
    // A payment's received_at is a timestamptz. Appending T00:00:00 to it
    // gave "Invalid Date", which printed on the guest's statement next to
    // every payment they had made.
    expect(formatDate("2026-08-15T22:04:11.123+00:00", "en")).toBe("15 Aug");
    expect(formatDate("2026-08-15", "en")).toBe("15 Aug");
  });

  it("returns nothing rather than Invalid Date", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
  });
});

/**
 * Reception said the date fields "don't work properly". A native date input
 * shows whatever the phone's locale says — often the year first, in
 * Arabic-Indic digits — so the screen now says the chosen day back in words.
 * The weekday is the part that catches a wrong pick.
 */
describe("a date written out in full", () => {
  it("names the weekday, so a wrong pick is visible", () => {
    expect(fullDate("2026-08-20", "ar")).toContain("الخميس");
    expect(fullDate("2026-08-20", "en")).toContain("Thursday");
  });

  it("writes the month as a word, never as a number", () => {
    expect(fullDate("2026-08-20", "ar")).toContain("أغسطس");
    expect(fullDate("2026-08-20", "en")).toContain("August");
    expect(fullDate("2026-08-20", "ar")).not.toMatch(/\b08\b/);
  });

  it("carries the year, because a stay can cross into January", () => {
    expect(fullDate("2027-01-02", "en")).toContain("2027");
  });

  it("says nothing rather than Invalid Date", () => {
    expect(fullDate("")).toBe("");
    expect(fullDate("nope")).toBe("");
    expect(fullDate(null)).toBe("");
  });
});
