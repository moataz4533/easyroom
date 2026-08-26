import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENCY_CODES, DIAL_CODES, TIMEZONES,
  currencyWord, hotelCurrency, hotelDialCode, hotelZone, setHotelSettings,
} from "../lib/hotel-settings";

afterEach(() => setHotelSettings(null));

describe("the hotel's own clock", () => {
  /**
   * The bug this closes: `today()` decided the day in Africa/Cairo for
   * everybody. A hotel in Riyadh would have had the wrong arrivals list for
   * the hour either side of midnight, and nothing would have looked broken.
   */
  it("uses the hotel's timezone once the property is known", () => {
    setHotelSettings({ timezone: "Asia/Riyadh", currency: "SAR" });
    expect(hotelZone()).toBe("Asia/Riyadh");
  });

  it("falls back to the device rather than to someone else's country", () => {
    setHotelSettings(null);
    expect(hotelZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("ignores a property with no timezone set", () => {
    setHotelSettings({ timezone: "", currency: "EGP" });
    expect(hotelZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("the hotel's own money", () => {
  it("uses the hotel's currency", () => {
    setHotelSettings({ timezone: "Asia/Riyadh", currency: "SAR" });
    expect(hotelCurrency()).toBe("SAR");
  });

  it("keeps Egyptian pounds when a hotel has not said otherwise", () => {
    setHotelSettings({ timezone: "Africa/Cairo" });
    expect(hotelCurrency()).toBe("EGP");
  });
});

describe("the word after the number", () => {
  /**
   * The trap: `Intl`'s narrow symbol for EGP is `E£`, in Arabic as well as
   * English. No Egyptian hotel writes that, and every screen in this app has
   * said «ج» since the first week. Asking Intl would have changed every
   * money line in the product on the way to supporting a second country.
   */
  it("keeps the words this app has always printed", () => {
    setHotelSettings({ currency: "EGP" });
    expect(currencyWord("ar")).toBe("ج");
    expect(currencyWord("en")).toBe("EGP");
  });

  it("knows the currencies next door", () => {
    expect(currencyWord("ar", "SAR")).toBe("ر.س");
    expect(currencyWord("en", "SAR")).toBe("SAR");
    expect(currencyWord("ar", "USD")).toBe("$");
  });

  /** Never wrong, and reads the same in both languages. */
  it("falls back to the ISO code rather than a guessed symbol", () => {
    expect(currencyWord("ar", "ZZZ")).toBe("ZZZ");
    expect(currencyWord("en", "zzz")).toBe("ZZZ");
  });

  it("follows the hotel without being told the code", () => {
    setHotelSettings({ currency: "SAR" });
    expect(currencyWord("ar")).toBe("ر.س");
  });
});

describe("the hotel's country code", () => {
  it("comes from the property's settings", () => {
    setHotelSettings({ settings: { dial_code: "+966" } });
    expect(hotelDialCode()).toBe("966");
  });

  it("keeps Egypt when a hotel has not said otherwise", () => {
    setHotelSettings({ timezone: "Africa/Cairo" });
    expect(hotelDialCode()).toBe("20");
  });

  it("survives a code typed with punctuation or left blank", () => {
    setHotelSettings({ settings: { dial_code: "00 971" } });
    expect(hotelDialCode()).toBe("00971");
    setHotelSettings({ settings: { dial_code: "  " } });
    expect(hotelDialCode()).toBe("20");
  });
});

describe("what the settings screen offers", () => {
  it("lists the currencies it has words for, Egypt first", () => {
    expect(CURRENCY_CODES[0]).toBe("EGP");
    expect(CURRENCY_CODES).toContain("SAR");
  });

  it("pairs every dialling code with a country in both languages", () => {
    for (const country of DIAL_CODES) {
      expect(country.code, country.en).toMatch(/^\d+$/);
      expect(country.ar.length, country.en).toBeGreaterThan(1);
      expect(country.en.length, country.en).toBeGreaterThan(1);
    }
  });

  it("offers a timezone for every dialling code's country", () => {
    expect(TIMEZONES).toContain("Africa/Cairo");
    expect(TIMEZONES.length).toBeGreaterThanOrEqual(DIAL_CODES.length);
  });
});
