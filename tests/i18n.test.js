import { describe, expect, it } from "vitest";
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
  it("preserves the current page while changing locale", () => {
    expect(localePath("/ar/bookings?open=1", "en")).toBe("/en/bookings?open=1");
    expect(barePath("/en/housekeeping")).toBe("/housekeeping");
  });
  it("falls back to Arabic when an English managed name is missing", () => {
    expect(localizedName({ name: "غرفة بحرية", name_en: "" }, "en")).toBe("غرفة بحرية");
    expect(localizedName({ name: "غرفة بحرية", name_en: "Sea View" }, "en")).toBe("Sea View");
  });
});
