import { describe, expect, it } from "vitest";
import {
  BILL_ALLOCATION_FIELDS, billTotals, billableRooms, buildBillText, extraLines,
  paymentLines, roomLines,
} from "../lib/bill";

const allocations = [
  { rooms: { number: "101" }, starts_on: "2026-08-15", ends_on: "2026-08-18",
    occupancy: 2, rate_per_night: "600", release_reason: null },
  { rooms: { number: "102" }, starts_on: "2026-08-15", ends_on: "2026-08-17",
    occupancy: 2, rate_per_night: "500", release_reason: null },
  // Taken off the booking, so off the bill.
  { rooms: { number: "103" }, starts_on: "2026-08-15", ends_on: "2026-08-18",
    occupancy: 2, rate_per_night: "600", release_reason: "إلغاء غرفة" },
];

const charges = [
  { description: "فطار", quantity: 4, unit_amount: "60", amount: "240", voided_at: null },
  { description: "غسيل", quantity: 1, unit_amount: "150", amount: "150", voided_at: null },
  { description: "خطأ", quantity: 1, unit_amount: "999", amount: "999", voided_at: "2026-08-16" },
];

const payments = [
  { received_at: "2026-08-16T10:00:00Z", method: "cash", amount: "1000", notes: "" },
  { received_at: "2026-08-15T10:00:00Z", method: "instapay", amount: "500", notes: "" },
  { received_at: "2026-08-17T10:00:00Z", method: "cash", amount: "-200", notes: "استرداد" },
];

describe("what belongs on the bill", () => {
  it("keeps the rooms the guest actually had", () => {
    expect(billableRooms(allocations)).toHaveLength(2);
    // A room cancelled off the booking is not billed.
    expect(roomLines(allocations).map((l) => l.room)).toEqual(["101", "102"]);
  });

  it("prices each room by its nights, not by the booking's dates", () => {
    const [first, second] = roomLines(allocations);
    expect(first).toMatchObject({ nights: 3, rate: 600, total: 1800 });
    expect(second).toMatchObject({ nights: 2, rate: 500, total: 1000 });
  });

  it("drops a voided line from the bill but not from the record", () => {
    expect(extraLines(charges).map((l) => l.description)).toEqual(["فطار", "غسيل"]);
    expect(extraLines(charges)[0]).toMatchObject({ quantity: 4, unit: 60, total: 240 });
  });

  it("puts the payments in the order they were taken, refunds included", () => {
    const lines = paymentLines(payments);
    expect(lines.map((l) => l.amount)).toEqual([500, 1000, -200]);
  });
});

describe("the sums", () => {
  const totals = billTotals({ allocations, charges, payments });

  it("adds the rooms and the extras, and subtracts what was paid", () => {
    expect(totals).toEqual({
      rooms: 2800, discount: 0, extras: 390, total: 3190, paid: 1300, balance: 1890,
    });
  });

  it("says nothing is owed when the payments cover it", () => {
    const settled = billTotals({
      allocations: [allocations[1]], charges: [], payments: [{ amount: "1000" }],
    });
    expect(settled).toMatchObject({ total: 1000, paid: 1000, balance: 0 });
  });

  it("copes with a booking that has nothing on it yet", () => {
    expect(billTotals({})).toEqual({
      rooms: 0, discount: 0, extras: 0, total: 0, paid: 0, balance: 0,
    });
  });
});

describe("the bill as the guest reads it", () => {
  const booking = {
    reference: "GR26-0011", check_in: "2026-08-15", check_out: "2026-08-18",
    guests: { full_name: "سامي عبد الله" },
  };
  const property = { name: "النادي اليوناني", name_en: "The Greek Club" };
  const text = buildBillText({ property, booking, allocations, charges, payments, locale: "ar" });

  it("names the hotel, the booking and the guest", () => {
    expect(text).toContain("النادي اليوناني");
    expect(text).toContain("GR26-0011");
    expect(text).toContain("سامي عبد الله");
  });

  it("shows each room with its nights and its rate", () => {
    expect(text).toMatch(/101/);
    expect(text).toMatch(/٣ ليلة × ٦٠٠ ج = ١٬٨٠٠ ج/);
  });

  it("shows a quantity only when there is more than one", () => {
    expect(text).toMatch(/فطار — ٤ × ٦٠ ج = ٢٤٠ ج/);
    expect(text).toMatch(/غسيل — ١٥٠ ج/);
    expect(text).not.toContain("خطأ");
  });

  it("ends on what is still owed", () => {
    expect(text).toContain("الإجمالي: ٣٬١٩٠ ج");
    expect(text).toContain("المتبقي: ١٬٨٩٠ ج");
  });

  it("says paid in full instead of a zero balance", () => {
    const settled = buildBillText({
      property, booking,
      allocations: [allocations[1]], charges: [], payments: [{ amount: "1000", received_at: "2026-08-17" }],
      locale: "ar",
    });
    expect(settled).toContain("الحساب مسدد بالكامل");
    expect(settled).not.toContain("المتبقي");
  });

  it("is written in the guest's language, not reception's", () => {
    const english = buildBillText({ property, booking, allocations, charges, payments, locale: "en" });
    expect(english).toContain("The Greek Club");
    expect(english).toContain("Statement of account");
    expect(english).toContain("Balance");
    expect(english).not.toContain("الإجمالي");
  });

  it("still produces something for a booking with no rooms left on it", () => {
    const bare = buildBillText({ property, booking, allocations: [], charges: [], payments: [], locale: "ar" });
    expect(bare).toContain("GR26-0011");
    expect(bare).toContain("الحساب مسدد بالكامل");
  });
});

/**
 * A discount is the one thing on a bill the guest is pleased to see, and the
 * one a hotel most wants a record of. So the line carries the price the room
 * is sold at, the money taken off, and the net — and the three have to agree
 * however the discount was expressed.
 */
describe("a room that was discounted", () => {
  // 3 nights, 500 a night before the discount, 10% off.
  const discounted = [{
    rooms: { number: "201" }, starts_on: "2026-08-15", ends_on: "2026-08-18",
    occupancy: 2, rate_per_night: "450", release_reason: null,
    discount_kind: "percent", discount_value: "10", discount_amount: "150",
  }];

  it("shows the price it was sold at, and what came off it", () => {
    const [line] = roomLines(discounted);
    expect(line).toMatchObject({
      nights: 3, rate: 450, total: 1350, discount: 150, grossRate: 500, grossTotal: 1500,
    });
  });

  it("bills the net, never the price before the discount", () => {
    expect(billTotals({ allocations: discounted, charges: [], payments: [] }))
      .toMatchObject({ rooms: 1350, discount: 150, total: 1350 });
  });

  it("puts both numbers on the paper the guest is handed", () => {
    const text = buildBillText({
      property: { name: "النادي اليوناني" },
      booking: { reference: "GR26-0012", check_in: "2026-08-15", check_out: "2026-08-18" },
      allocations: discounted, charges: [], payments: [], locale: "ar",
    });
    expect(text).toMatch(/٣ ليلة × ٥٠٠ ج = ١٬٥٠٠ ج/);
    expect(text).toMatch(/خصم ١٠٪ − ١٥٠ ج/);
    expect(text).toContain("الإجمالي: ١٬٣٥٠ ج");
    expect(text).toContain("وفّرت: ١٥٠ ج");
  });

  it("says nothing about discounts when there were none", () => {
    const text = buildBillText({
      property: { name: "x" }, booking: { reference: "y" },
      allocations, charges, payments, locale: "ar",
    });
    expect(text).not.toContain("خصم");
    expect(text).not.toContain("وفّرت");
  });

  it("names a fixed sum off without inventing a percentage", () => {
    const flat = [{ ...discounted[0], discount_kind: "amount", discount_value: "50" }];
    const text = buildBillText({
      property: { name: "x" }, booking: { reference: "y" },
      allocations: flat, charges: [], payments: [], locale: "en",
    });
    expect(text).toContain("Discount − 150 EGP");
    expect(text).not.toContain("%");
  });
});

/**
 * The statement is built from rows another screen loaded, so it is only as
 * good as that screen's select list. It shipped pricing every room at zero
 * because the bookings query did not ask for rate_per_night, and the bill
 * read `undefined` as nothing rather than as a mistake.
 */
describe("what the bill needs from whoever loaded the rows", () => {
  const FIELDS = [
    "starts_on", "ends_on", "rate_per_night", "release_reason",
    "discount_kind", "discount_value", "discount_amount",
  ];

  it("names the allocation columns it reads, so a query can be checked against them", () => {
    expect(BILL_ALLOCATION_FIELDS).toEqual(FIELDS);
  });

  it("refuses to price a room whose rate was never loaded", () => {
    const withoutRate = [{ rooms: { number: "101" }, starts_on: "2026-08-17",
      ends_on: "2026-08-20", occupancy: 2, release_reason: null }];
    expect(() => billTotals({ allocations: withoutRate })).toThrow(/rate_per_night/);
  });

  it("still prices a genuinely free night at zero", () => {
    const free = [{ rooms: { number: "101" }, starts_on: "2026-08-17",
      ends_on: "2026-08-20", occupancy: 2, rate_per_night: 0, release_reason: null }];
    expect(billTotals({ allocations: free }).rooms).toBe(0);
  });
});
