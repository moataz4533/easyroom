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
   * Guest counts are deliberately NOT declined — "١ فرد ٢ فرد ٣ فرد", never
   * "فرد واحد" and "فردان". The owner asked for it: at the desk these are
   * quantities being scanned down a list, not sentences being read, and the
   * dual form makes two rows in the same column look like different things.
   * Nights and rooms keep their grammar; only people are flattened.
   */
  it("counts people as a plain number, not in declined Arabic", () => {
    const flat = [
      ["NewBooking", "paxOption", "count"],
      ["Paste", "paxCount", "count"],
      ["Settings", "occFallback", "count"],
      ["Calendar", "guests", "count"],
    ];
    for (const [namespace, key, arg] of flat) {
      const message = new IntlMessageFormat(ar[namespace][key], "ar-u-nu-arab");
      expect(message.format({ [arg]: 1 }), `${namespace}.${key}`).toBe("١ فرد");
      expect(message.format({ [arg]: 2 }), `${namespace}.${key}`).toBe("٢ فرد");
      expect(message.format({ [arg]: 3 }), `${namespace}.${key}`).toBe("٣ فرد");
    }
    // The lines that carry a people count beside something else keep the
    // grammar of that something else.
    const line = new IntlMessageFormat(ar.Bookings.stayLine, "ar-u-nu-arab");
    expect(line.format({ nights: 2, pax: 2 })).toBe("ليلتان · ٢ فرد");
  });

  /** An empty branch used to leave a space stranded before the full stop. */
  it("reads cleanly when the message asked for only one of the two", () => {
    for (const [locale, messages] of [["ar", ar], ["en", en]]) {
      const asked = new IntlMessageFormat(messages.Paste.asked, locale);
      for (const args of [{ rooms: 2, pax: 2 }, { rooms: 1, pax: 0 }, { rooms: 0, pax: 3 }]) {
        const text = asked.format(args);
        expect(text, `${locale} ${JSON.stringify(args)}`).not.toMatch(/\s\.$/);
        expect(text, `${locale} ${JSON.stringify(args)}`).not.toMatch(/\s{2}/);
      }
    }
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

  /**
   * A message asking for `{count}` that is handed `{n}` renders the
   * placeholder to the guest, or throws — and nothing else notices, because
   * the key exists, the code compiles and no test renders the screen.
   */
  it("hands every message the arguments it asks for", () => {
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        if (["node_modules", ".next", ".git", "tests"].includes(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.jsx$/.test(path)) files.push(path);
      }
    })(".");

    const placeholders = (text) =>
      new Set([...text.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]));

    // Only the top level of the argument object: a nested options object —
    // toLocaleString's, say — is not a set of message arguments.
    const topLevel = (body) => {
      let depth = 0;
      let flat = "";
      for (const ch of body) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        else if (depth === 0) flat += ch;
      }
      return new Set([
        ...[...flat.matchAll(/(\w+)\s*:/g)].map((m) => m[1]),
        // shorthand: t("stay", { nights, heads })
        ...flat.split(",").map((part) => part.trim()).filter((part) => /^\w+$/.test(part)),
      ]);
    };

    const wrong = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const namespaces = {};
      for (const m of source.matchAll(/const\s+(\w+)\s*=\s*useTranslations\("([\w.]+)"\)/g)) {
        (namespaces[m[1]] ||= []).push(m[2]);
      }
      for (const [name, spaces] of Object.entries(namespaces)) {
        const calls = new RegExp(
          `\\b${name}\\("([\\w.]+)"\\s*,\\s*\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}\\s*\\)`, "g");
        for (const use of source.matchAll(calls)) {
          const passed = topLevel(use[2]);
          // One name may read from several catalogues in one file, so the
          // call is right if any of them wants exactly these arguments.
          const matches = spaces.some((space) => {
            const text = `${space}.${use[1]}`.split(".").reduce((node, key) => (node ?? {})[key], ar);
            if (typeof text !== "string") return false;
            const want = placeholders(text);
            return want.size === passed.size && [...want].every((w) => passed.has(w));
          });
          const known = spaces.some((space) =>
            typeof `${space}.${use[1]}`.split(".").reduce((node, key) => (node ?? {})[key], ar) === "string");
          if (known && !matches) wrong.push(`${file}: ${use[1]} got [${[...passed].sort()}]`);
        }
      }
    }
    expect(wrong).toEqual([]);
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
      "restored", "guests_cleaned", "data_reset", "dates_changed",
    ]) {
      expect(typeof ar.Activity[`action_${action}`], action).toBe("string");
    }
    for (const type of ["all", "booking", "housekeeping", "money", "admin"]) {
      expect(typeof ar.Activity[`type_${type}`], type).toBe("string");
    }
    for (const key of ["7", "30", "month", "90", "custom"]) {
      expect(typeof ar.Reports[`range_${key}`], key).toBe("string");
    }
    for (const method of ["cash", "instapay", "vodafone_cash", "card", "transfer"]) {
      expect(typeof ar.Bookings[`method_${method}`], method).toBe("string");
      expect(typeof ar.Reports[`method_${method}`], method).toBe("string");
    }
    for (const status of ["inquiry", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"]) {
      expect(typeof ar.Bookings[`status_${status}`], status).toBe("string");
    }
    for (const key of ["active", "today", "past", "cancelled"]) {
      expect(typeof ar.Bookings[`filter_${key}`], key).toBe("string");
    }
    // Every reason the cancel dialog offers, and the same names again in
    // the log — a reason that reads as a raw key is a reason nobody trusts.
    for (const key of ["guest_cancelled", "date_change", "duplicate", "mistake", "other"]) {
      expect(typeof ar.Bookings[`reason_${key}`], key).toBe("string");
      expect(typeof ar.Activity[`reason_${key}`], key).toBe("string");
    }
    for (const source of ["whatsapp", "phone", "walk_in", "website", "ota", "referral", "other"]) {
      expect(typeof ar.Reports[`source_${source}`], source).toBe("string");
    }
    for (const key of ["1", "2", "3", "4", "5", "6"]) {
      expect(typeof ar.Settings[`occ_${key}`], key).toBe("string");
    }
    for (const role of ["owner", "manager", "reception", "housekeeping"]) {
      expect(typeof ar.Settings[`role_${role}`], role).toBe("string");
      expect(typeof ar.Roles[role], role).toBe("string");
    }
    for (const role of ["reception", "housekeeping", "manager"]) {
      expect(typeof ar.Settings[`roleOption_${role}`], role).toBe("string");
    }
    for (const tab of ["rates", "seasons", "rooms", "charges", "accounts", "staff", "security", "backup", "property"]) {
      expect(typeof ar.Settings[`tab_${tab}`], tab).toBe("string");
    }
    for (const group of ["types", "plans"]) {
      expect(typeof ar.Settings[`englishGroup_${group}`], group).toBe("string");
    }
    for (const status of ["confirmed", "checked_in", "checked_out", "cancelled", "no_show", "inquiry"]) {
      expect(typeof ar.Guests[`status_${status}`], status).toBe("string");
    }
    // Every problem newHotelProblems can report has to have a sentence.
    for (const problem of [
      "name", "code:empty", "code:short", "code:long", "code:reserved",
      "code:taken", "ownerName", "ownerEmail", "password", "mismatch",
    ]) {
      expect(typeof ar.Platform[`problem_${problem}`], problem).toBe("string");
    }
    // Every shape of discount, the label for its value, and every problem
    // discountProblem can report.
    for (const kind of ["percent", "amount", "rate"]) {
      expect(typeof ar.Discount[`kind_${kind}`], kind).toBe("string");
      expect(typeof ar.Discount[`value_${kind}`], kind).toBe("string");
    }
    for (const problem of ["unknownKind", "needValue", "negative", "overHundred", "noDiscount"]) {
      expect(typeof ar.Discount[problem], problem).toBe("string");
    }
    // The setup checklist asks for `${id}.title` and `${id}.why`.
    for (const id of ["rates", "roomTypes", "managerPassword", "whatsapp", "policy", "staff"]) {
      expect(typeof ar.Setup[id]?.title, id).toBe("string");
      expect(typeof ar.Setup[id]?.why, id).toBe("string");
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
