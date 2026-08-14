import { describe, expect, it } from "vitest";
import {
  buildConfirmation, cancellationPolicy, formatTime, propertyName, whatsappLink,
} from "../lib/confirmation";

const property = {
  name: "النادي اليوناني",
  name_en: "The Greek Club",
  default_check_in_time: "14:00:00",
  default_check_out_time: "12:00:00",
  settings: {
    address: "دهب، جنوب سيناء",
    cancellation_policy: "الإلغاء مجاني قبل الوصول بـ ٤٨ ساعة.",
    cancellation_policy_en: "Free cancellation up to 48 hours before arrival.",
  },
};

const booking = {
  reference: "GC-2608-0042",
  check_in: "2026-08-14",
  check_out: "2026-08-17",
  adults: 2,
  total_amount: 1500,
  paid_amount: 500,
  guests: { full_name: "Sarah Whitfield", phone: "+20 100 123 4567" },
};

const rooms = [{ number: "101", occupancy: 2 }];

describe("confirmation message", () => {
  it("states the stay, the money owed and the policy in Arabic", () => {
    const text = buildConfirmation({ property, booking, rooms, locale: "ar" });
    expect(text).toContain("النادي اليوناني");
    expect(text).toContain("GC-2608-0042");
    expect(text).toContain("Sarah Whitfield");
    expect(text).toContain("101");
    expect(text).toContain("٣ ليالي");
    expect(text).toContain("١٬٥٠٠ ج");
    expect(text).toContain("المتبقي: ١٬٠٠٠ ج");
    expect(text).toContain("الإلغاء مجاني قبل الوصول بـ ٤٨ ساعة.");
    expect(text).toContain("دهب، جنوب سيناء");
  });

  it("uses the English name and policy when asked for English", () => {
    const text = buildConfirmation({ property, booking, rooms, locale: "en" });
    expect(text).toContain("The Greek Club");
    expect(text).toContain("3 nights");
    expect(text).toContain("Total: 1,500 EGP");
    expect(text).toContain("Balance due: 1,000 EGP");
    expect(text).toContain("Free cancellation up to 48 hours before arrival.");
    expect(text).not.toContain("النادي اليوناني");
  });

  it("counts in Arabic the way it is spoken, not with a number for everything", () => {
    const text = buildConfirmation({ property, booking, rooms, locale: "ar" });
    expect(text).toContain("الغرفة: 101");
    expect(text).toContain("فردين");
    expect(text).not.toContain("٢ أفراد");
  });

  it("says paid in full instead of showing a zero balance", () => {
    const settled = { ...booking, paid_amount: 1500 };
    expect(buildConfirmation({ property, booking: settled, rooms, locale: "en" })).toContain("Paid in full");
    expect(buildConfirmation({ property, booking: settled, rooms, locale: "ar" })).toContain("الحساب مدفوع بالكامل");
  });

  it("counts the guests actually placed in rooms, not the booking header", () => {
    const text = buildConfirmation({
      property, booking, locale: "en",
      rooms: [{ number: "101", occupancy: 2 }, { number: "102", occupancy: 3 }],
    });
    expect(text).toContain("101 / 102");
    expect(text).toContain("5 guests");
  });

  it("falls back to the Arabic policy when no English one was written", () => {
    const bare = { ...property, settings: { cancellation_policy: "بدون استرداد." } };
    expect(cancellationPolicy(bare, "en")).toBe("بدون استرداد.");
    expect(cancellationPolicy({ settings: {} }, "ar")).toBe("");
  });

  it("survives a hotel with no policy, no address and no English name", () => {
    const bare = { name: "فندق", settings: {} };
    const text = buildConfirmation({ property: bare, booking, rooms, locale: "en" });
    expect(propertyName(bare, "en")).toBe("فندق");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});

describe("times and links", () => {
  it("shows check-in and check-out times in both languages", () => {
    expect(formatTime("14:00:00", "en")).toMatch(/2:00\s*pm/i);
    expect(formatTime("12:00:00", "ar")).toContain("١٢:٠٠");
    expect(formatTime(null, "en")).toBe("");
  });

  it("builds a wa.me link from a messy phone number", () => {
    expect(whatsappLink("+20 100 123 4567", "hi")).toBe("https://wa.me/201001234567?text=hi");
  });

  it("refuses to build a link with no number", () => {
    expect(whatsappLink("", "hi")).toBeNull();
    expect(whatsappLink(null, "hi")).toBeNull();
  });
});
