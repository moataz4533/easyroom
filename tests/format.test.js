import { describe, expect, it } from "vitest";
import { countNights, formatCurrency, formatDate, totalQuote } from "../lib/format";
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
