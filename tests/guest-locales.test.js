import { describe, expect, it } from "vitest";
import { GUEST_LOCALES, LANGUAGE_NAMES, isRtl, labelsFor } from "../lib/guest-locales";
import { LOCALE_TAGS, formatNumber } from "../lib/format";
import { currencyWord, setHotelSettings } from "../lib/hotel-settings";
import { buildConfirmation } from "../lib/confirmation";

describe("the languages a guest's paperwork can be in", () => {
  it("names every one of them in itself", () => {
    for (const locale of GUEST_LOCALES) {
      expect(LANGUAGE_NAMES[locale], locale).toBeTruthy();
    }
  });

  it("knows Arabic is the only one written right to left", () => {
    expect(isRtl("ar")).toBe(true);
    for (const locale of GUEST_LOCALES.filter((l) => l !== "ar")) {
      expect(isRtl(locale), locale).toBe(false);
    }
  });

  /**
   * The trap this closes. Every one of these falls back somewhere when it
   * has no answer, and every fallback used to land on Arabic — so an
   * Italian guest would have been handed ٢٠٢٦ for the year, «ج» after the
   * total, and Arabic words for anything untranslated. English is a plain
   * document; Arabic is the wrong one.
   */
  it("has a number format for every language, so none falls back to Arabic digits", () => {
    for (const locale of GUEST_LOCALES) {
      expect(LOCALE_TAGS[locale], locale).toBeTruthy();
    }
    expect(formatNumber(2026, "ru")).not.toMatch(/[٠-٩]/);
    expect(formatNumber(2026, "de")).not.toMatch(/[٠-٩]/);
    expect(formatNumber(1400, "it")).not.toMatch(/[٠-٩]/);
  });

  it("writes the currency in Latin for every language but Arabic", () => {
    setHotelSettings({ currency: "EGP" });
    expect(currencyWord("ar")).toBe("ج");
    for (const locale of ["en", "ru", "de", "it"]) {
      expect(currencyWord(locale), locale).toBe("EGP");
    }
  });

  it("falls back to English, never to Arabic, for a language with no table", () => {
    const tables = { ar: { a: "عربي" }, en: { a: "English" } };
    expect(labelsFor(tables, "pl")).toEqual({ a: "English" });
    expect(labelsFor(tables, "ar")).toEqual({ a: "عربي" });
  });
});

describe("a confirmation in each language", () => {
  const property = {
    name: "النادي اليوناني", name_en: "Greek Club",
    settings: { cancellation_policy: "إلغاء مجاني قبل ٤٨ ساعة", cancellation_policy_en: "Free cancellation 48h before" },
  };
  const booking = {
    reference: "GR26-0001", check_in: "2026-09-04", check_out: "2026-09-07",
    total_amount: 4200, paid_amount: 1000,
    guests: { full_name: "Hans Weber" },
  };
  const rooms = [{ number: "101", occupancy: 2 }];

  it("writes the hotel's Latin name and the English policy for a German guest", () => {
    setHotelSettings({ currency: "EGP" });
    const text = buildConfirmation({ property, booking, rooms, locale: "de" });
    expect(text).toContain("Greek Club");
    expect(text).toContain("Buchungsbestätigung");
    expect(text).toContain("Free cancellation 48h before");
    // Nothing Arabic anywhere in a German document — not a word, not a digit.
    expect(text).not.toMatch(/[؀-ۿ]/);
  });

  it("declines Russian nights the way Russian declines them", () => {
    const one = buildConfirmation({ property, booking: { ...booking, check_out: "2026-09-05" }, rooms, locale: "ru" });
    const three = buildConfirmation({ property, booking, rooms, locale: "ru" });
    expect(one).toContain("1 ночь");
    expect(three).toContain("3 ночи");
    expect(three).not.toMatch(/[؀-ۿ]/);
  });

  it("still writes Arabic for an Arabic guest", () => {
    const text = buildConfirmation({ property, booking, rooms, locale: "ar" });
    expect(text).toContain("النادي اليوناني");
    expect(text).toContain("تأكيد حجز");
  });
});

/**
 * The bill and the proof go to the same guest as the confirmation, so a
 * leak in either is the same failure: a document in a language the person
 * holding it cannot read.
 */
describe("the other two documents", () => {
  const property = { name: "النادي اليوناني", name_en: "Greek Club", settings: {} };
  const booking = {
    reference: "GR26-0044", check_in: "2026-09-04", check_out: "2026-09-07",
    total_amount: 4200, paid_amount: 1000, guests: { full_name: "Hans Weber" },
  };
  const allocations = [{
    starts_on: "2026-09-04", ends_on: "2026-09-07", occupancy: 2,
    rate_per_night: 1400, released_at: null, kind: "booking",
    rooms: { number: "101" },
  }];

  it("writes the bill with nothing Arabic in it", async () => {
    const { buildBillText } = await import("../lib/bill");
    setHotelSettings({ currency: "EGP" });
    const text = buildBillText({
      property, booking, allocations, charges: [], payments: [], locale: "ru",
    });
    expect(text).toContain("Greek Club");
    expect(text).not.toMatch(/[؀-ۿ]/);
  });

  it("writes the reservation proof with nothing Arabic in it", async () => {
    const { buildReservationProofText } = await import("../lib/reservation-proof");
    setHotelSettings({ currency: "EGP" });
    const text = buildReservationProofText({
      property, booking, allocations, charges: [], locale: "de",
    });
    expect(text).toContain("Greek Club");
    expect(text).not.toMatch(/[؀-ۿ]/);
  });
});
