import { describe, expect, it } from "vitest";
import {
  chargeLabel, chargesTotal, lineTotal, liveCharges,
  roomsSubtotal, validateCharge, voidedCharges,
} from "../lib/charges";
import { buildConfirmation } from "../lib/confirmation";

const charges = [
  { id: "1", description: "فطار", quantity: 6, unit_amount: 80, amount: 480, charge_item_id: "item-breakfast" },
  { id: "2", description: "ترانسفير من شرم", quantity: 1, unit_amount: 900, amount: 900, charge_item_id: null },
  { id: "3", description: "غسيل", quantity: 2, unit_amount: 50, amount: 100, voided_at: "2026-08-14T09:00:00Z" },
];

describe("what the extras add up to", () => {
  it("ignores a voided line without losing it", () => {
    expect(chargesTotal(charges)).toBe(1380);
    expect(liveCharges(charges)).toHaveLength(2);
    expect(voidedCharges(charges)).toHaveLength(1);
  });

  it("copes with no extras at all", () => {
    expect(chargesTotal([])).toBe(0);
    expect(chargesTotal(null)).toBe(0);
    expect(chargesTotal(undefined)).toBe(0);
  });

  it("falls back to quantity × price when the stored total is absent", () => {
    expect(chargesTotal([{ id: "x", quantity: 3, unit_amount: 25 }])).toBe(75);
    expect(lineTotal("2.5", "40")).toBe(100);
    expect(lineTotal("", "40")).toBe(0);
  });

  it("splits a bill back into rooms and extras", () => {
    // The database keeps one total that already includes the extras.
    expect(roomsSubtotal(2880, charges)).toBe(1500);
    expect(roomsSubtotal(1500, [])).toBe(1500);
  });

  it("never reports a negative room half if the numbers disagree", () => {
    expect(roomsSubtotal(100, charges)).toBe(0);
  });

  it("shows the catalogue name in the reader's language, and the typed one otherwise", () => {
    const items = [{ id: "item-breakfast", name: "فطار", name_en: "Breakfast" }];
    expect(chargeLabel(charges[0], items, "en")).toBe("Breakfast");
    expect(chargeLabel(charges[0], items, "ar")).toBe("فطار");
    expect(chargeLabel(charges[1], items, "en")).toBe("ترانسفير من شرم");
  });
});

describe("what will not be accepted as a line", () => {
  const good = { description: "فطار", quantity: 2, amount: 80 };

  it("accepts a complete line", () => {
    expect(validateCharge(good)).toBeNull();
  });

  it("refuses a line with no description", () => {
    expect(validateCharge({ ...good, description: "  " })).toBe("needDescription");
  });

  it("refuses zero, negative and non-numeric quantities", () => {
    expect(validateCharge({ ...good, quantity: 0 })).toBe("needQuantity");
    expect(validateCharge({ ...good, quantity: -1 })).toBe("needQuantity");
    expect(validateCharge({ ...good, quantity: "abc" })).toBe("needQuantity");
  });

  it("allows a free line but not a negative one", () => {
    expect(validateCharge({ ...good, amount: 0 })).toBeNull();
    expect(validateCharge({ ...good, amount: -5 })).toBe("needAmount");
    expect(validateCharge({ ...good, amount: "" })).toBe("needAmount");
  });
});

describe("the extras reach the guest's copy", () => {
  const property = { name: "النادي اليوناني", name_en: "The Greek Club", settings: {} };
  const booking = {
    reference: "GC-2608-0042", check_in: "2026-08-14", check_out: "2026-08-17",
    adults: 2, total_amount: 2880, paid_amount: 0,
    guests: { full_name: "Sarah Whitfield" },
    booking_charges: charges,
  };

  it("shows the room half beside the extras, so the guest need not ask", () => {
    const text = buildConfirmation({ property, booking, rooms: [{ number: "101", occupancy: 2 }], locale: "en" });
    expect(text).toContain("Rooms: 1,500 EGP");
    expect(text).toContain("Extras: 1,380 EGP");
    expect(text).toContain("Total: 2,880 EGP");
  });

  it("stays a single total when nothing extra was sold", () => {
    const plain = { ...booking, total_amount: 1500, booking_charges: [] };
    const text = buildConfirmation({ property, booking: plain, rooms: [], locale: "en" });
    expect(text).toContain("Total: 1,500 EGP");
    expect(text).not.toContain("Extras:");
  });
});
