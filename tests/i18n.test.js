import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { barePath, localePath, localizedName } from "../lib/locale-utils";

function keys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? keys(child, path) : [path];
  });
}

describe("bilingual routing and messages", () => {
  it("keeps Arabic and English message keys identical", () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  // A malformed plural throws where it is rendered, not where it was
  // written, so every message is compiled here instead.
  it("compiles every message in both languages", () => {
    for (const [locale, messages] of [["ar", ar], ["en", en]]) {
      for (const path of keys(messages)) {
        const text = path.split(".").reduce((node, key) => node[key], messages);
        expect(() => new IntlMessageFormat(text, locale), `${locale}: ${path}`).not.toThrow();
      }
    }
  });

  it("declines the Arabic plurals the counters actually hit", () => {
    const lead = new IntlMessageFormat(ar.Provisional.leadFailed, "ar");
    expect(lead.format({ count: 1 })).toContain("حجز مبدئي واحد");
    expect(lead.format({ count: 2 })).toContain("حجزان");
    expect(lead.format({ count: 3 })).toContain("حجوزات");
    const stay = new IntlMessageFormat(ar.Provisional.stay, "ar");
    expect(stay.format({ nights: 1, heads: 2, rooms: "101" })).toContain("ليلة واحدة");
    expect(stay.format({ nights: 3, heads: 2, rooms: "101" })).toContain("ليالٍ");
  });

  it("preserves the current page while changing locale", () => {
    expect(localePath("/ar/bookings?open=1", "en")).toBe("/en/bookings?open=1");
    expect(barePath("/en/housekeeping")).toBe("/housekeeping");
  });
  it("falls back to Arabic when an English managed name is missing", () => {
    expect(localizedName({ name: "غرفة بحرية", name_en: "" }, "en")).toBe("غرفة بحرية");
    expect(localizedName({ name: "غرفة بحرية", name_en: "Sea View" }, "en")).toBe("Sea View");
  });
});
