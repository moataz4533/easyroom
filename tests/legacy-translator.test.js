import { describe, expect, it } from "vitest";
import { LEGACY_EN, PATTERNS, translateLegacyText } from "../components/LegacyTranslator";
import { buildBillText } from "../lib/bill";

/**
 * The English-mode dictionary walks the whole page and rewrites Arabic text
 * nodes in place. What it must never rewrite is the hotel's own data — and
 * for a while it did, because it fell back to substring substitution on
 * anything it did not recognise.
 */
describe("text the app did not write", () => {
  const untouched = (value) => expect(translateLegacyText(value)).toBe(value);

  it("leaves a guest's name exactly as it was recorded", () => {
    // Every one of these came out mangled: "نور today", "أحمد الnew".
    untouched("نور اليوم");
    untouched("أحمد الجديد");
    untouched("محمد عبد الله");
    untouched("سعيد الغرباوي");
  });

  it("leaves a room type the manager named", () => {
    untouched("غرفة العروسين");   // was "room العروسين"
    untouched("غرف الحديقة");
  });

  it("leaves a note reception typed", () => {
    untouched("حجز مبكر — وصول 3 صباحاً");   // was "booking مبكر — …"
    untouched("طلب غرفة هادية");
    untouched("السعر اتفق عليه مع الحساب");
    untouched("سرير زيادة ليلة واحدة");
  });

  it("leaves a cancellation reason and an extra's description", () => {
    untouched("النزيل غيّر تاريخ السفر");
    untouched("فطار إضافي لفرد");
  });

  it("leaves an Arabic bill alone on an English-locale device", () => {
    // The bill is written in the guest's language, which is not the one
    // reception is working in. Every line of it used to be rewritten on its
    // way to the screen: "٣ ليلة × ٦٠٠ ج" came out "٣ night × ٦٠٠ EGP".
    const text = buildBillText({
      property: { name: "النادي اليوناني" },
      booking: {
        reference: "GR26-0011", check_in: "2026-08-15", check_out: "2026-08-18",
        guests: { full_name: "سامي عبد الله" },
      },
      allocations: [{
        rooms: { number: "101" }, starts_on: "2026-08-15", ends_on: "2026-08-18",
        occupancy: 2, rate_per_night: "600", release_reason: null,
      }],
      charges: [{ description: "فطار", quantity: 4, unit_amount: "60", amount: "240" }],
      payments: [], locale: "ar",
    });
    for (const line of text.split("\n")) expect(translateLegacyText(line), line).toBe(line);
  });

  it("never half-translates: it is all of a phrase or none of it", () => {
    for (const value of ["نور اليوم", "غرفة العروسين", "حجز مبكر"]) {
      const out = translateLegacyText(value);
      expect(/[a-z]/i.test(out)).toBe(false);
    }
  });
});

describe("text the app did write", () => {
  it("translates a phrase it knows exactly", () => {
    expect(translateLegacyText("حالة الغرف")).toBe("Room status");
    expect(translateLegacyText("كل الغرف جاهزة.")).toBe("All rooms are ready.");
  });

  it("keeps the whitespace the layout depends on", () => {
    expect(translateLegacyText("\n  تحديث  ")).toBe("\n  Refresh  ");
  });

  it("translates a counter without touching the number the app formatted", () => {
    expect(translateLegacyText("3 ليلة")).toBe("3 nights");
    expect(translateLegacyText("٣ ليالي")).toBe("٣ nights");
    expect(translateLegacyText("١٬٢٤٠ غرفة")).toBe("١٬٢٤٠ rooms");
    expect(translateLegacyText("2 أفراد")).toBe("2 guests");
    expect(translateLegacyText("١٢ عملية")).toBe("١٢ transactions");
    expect(translateLegacyText("٤ من ٦ ليلة")).toBe("٤ of ٦ nights");
    expect(translateLegacyText("5 غرفة تحتاج إجراءً.")).toBe("5 rooms need attention.");
  });

  it("only matches a counter end to end, so it cannot reach into a sentence", () => {
    // The old substring rule turned both of these into English mid-word.
    untouchedish("عايز 2 غرفة فوق");
    untouchedish("الحجز 3 ليلة بس مش مؤكد");
    function untouchedish(value) { expect(translateLegacyText(value)).toBe(value); }
  });

  it("translates the fragments JSX leaves on their own", () => {
    expect(translateLegacyText(" ج")).toBe(" EGP");
    expect(translateLegacyText("آخر تحديث:")).toBe("Last updated:");
    expect(translateLegacyText("فلوس متبقية (")).toBe("Outstanding balances (");
  });

  it("passes text with no Arabic in it straight through", () => {
    expect(translateLegacyText("GR26-0011")).toBe("GR26-0011");
    expect(translateLegacyText("")).toBe("");
    expect(translateLegacyText(null)).toBe(null);
  });
});

describe("the dictionary itself", () => {
  it("has no entry that would translate an Arabic phrase into Arabic", () => {
    for (const [ar, en] of Object.entries(LEGACY_EN)) {
      expect(/[؀-ۿ]/.test(en), `${ar} → ${en}`).toBe(false);
    }
  });

  it("matches only whole phrases, never parts of one", () => {
    // The dictionary is looked up by the trimmed text node, so every key is
    // an exact match by construction. The patterns are the only other way in,
    // and anchoring is what stops them reaching into a sentence somebody
    // typed — so every one of them has to be anchored at both ends.
    for (const [pattern] of PATTERNS) {
      expect(pattern.source.startsWith("^"), pattern.source).toBe(true);
      expect(pattern.source.endsWith("$"), pattern.source).toBe(true);
    }
  });
});
