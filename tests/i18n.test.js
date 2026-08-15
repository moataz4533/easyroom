import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
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

  /**
   * A key used in a screen but missing from the catalogue throws where it is
   * rendered — which is on a phone at the desk, not here. So every literal
   * key a screen asks for is checked against the catalogue.
   *
   * Only literal keys can be checked; `t(`state_${x}`)` is a template and is
   * skipped, which is why every such family also has a literal test of its
   * own further down.
   */
  it("has a message for every key the screens ask for", () => {
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        if (["node_modules", ".next", ".git", "tests"].includes(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.jsx$/.test(path)) files.push(path);
      }
    })(".");

    const missing = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Which catalogue each local name reads from: const t = useTranslations("Board").
      // One file holds several components, and each may bind the same name to
      // a different catalogue, so a name carries every namespace it is bound
      // to anywhere in the file. A key is missing only when no catalogue that
      // name ever reads from has it — enough to catch a typo or a forgotten
      // entry, without needing to know which component a line sits in.
      const namespaces = {};
      for (const m of source.matchAll(/const\s+(\w+)\s*=\s*useTranslations\("([\w.]+)"\)/g)) {
        (namespaces[m[1]] ||= []).push(m[2]);
      }
      for (const [name, spaces] of Object.entries(namespaces)) {
        const uses = new RegExp(`\\b${name}\\("([\\w.]+)"`, "g");
        for (const use of source.matchAll(uses)) {
          const anywhere = spaces.some((namespace) =>
            typeof `${namespace}.${use[1]}`.split(".").reduce((node, key) => (node ?? {})[key], ar) === "string");
          if (!anywhere) missing.push(`${file}: ${[...new Set(spaces)].join("|")}.${use[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has every member of the key families built from a variable", () => {
    for (const state of ["free", "occupied", "dirty", "ooo"]) {
      expect(typeof ar.Board[`state_${state}`], state).toBe("string");
    }
    for (const source of ["whatsapp", "phone", "walk_in", "website", "ota", "referral", "other"]) {
      expect(typeof ar.Board[`source_${source}`], source).toBe("string");
    }
    for (const source of ["whatsapp", "phone", "walk_in", "referral", "other"]) {
      expect(typeof ar.NewBooking[`source_${source}`], source).toBe("string");
    }
    for (const status of ["dirty", "clean", "inspected", "out_of_order"]) {
      expect(typeof ar.Housekeeping[`status_${status}`], status).toBe("string");
      expect(typeof ar.Activity[`status_${status}`], status).toBe("string");
    }
    // Every action the log writes, so a new one cannot reach the screen
    // as a raw database word.
    for (const action of [
      "created", "checked_in", "checked_out", "housekeeping_status_changed",
      "received", "refunded", "extended", "shortened", "room_moved", "cancelled",
      "no_show", "room_blocked", "room_unblocked", "pin_changed", "updated",
      "restored", "guests_cleaned",
    ]) {
      expect(typeof ar.Activity[`action_${action}`], action).toBe("string");
    }
    for (const type of ["all", "booking", "housekeeping", "money", "admin"]) {
      expect(typeof ar.Activity[`type_${type}`], type).toBe("string");
    }
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
