import { describe, expect, it } from "vitest";
import { buildReservationProofText, reservationProofModel } from "../lib/reservation-proof";

const property = { name: "فندق النخيل", name_en: "Palm Hotel" };
const booking = {
  reference: "PH-2608-0012",
  check_in: "2026-08-25",
  check_out: "2026-08-28",
  adults: 3,
  total_amount: 1950,
  source: "whatsapp",
  notes: "وصول بعد الساعة 9 مساءً",
  guests: { full_name: "أحمد محمود", phone: "+20 100 123 4567", id_number: "A12345678" },
  rate_plans: { code: "CORP-BB", name: "شركة — فطار", name_en: "Corporate B&B" },
  accounts: { name: "شركة النور" },
};
const allocations = [{
  occupancy: 3,
  rooms: { number: "204", room_types: { name: "ديلوكس", name_en: "Deluxe" } },
}];
const charges = [
  { description: "فطار", description_en: "Breakfast", quantity: 9, unit_amount: 0, amount: 0, is_included: true, pricing_basis: "per_guest_night" },
  { description: "نقل من المطار", description_en: "Airport transfer", quantity: 1, unit_amount: 150, amount: 150, is_included: false, pricing_basis: "per_booking" },
  { description: "سطر ملغي", quantity: 1, unit_amount: 50, amount: 50, is_included: false, voided_at: "2026-08-25T10:00:00Z" },
];

describe("reservation proof", () => {
  it("keeps included services separate from paid extras and room revenue", () => {
    const model = reservationProofModel({ booking, allocations, charges, locale: "ar" });
    expect(model.guestCount).toBe(3);
    expect(model.included).toEqual([expect.objectContaining({ name: "فطار", quantity: 9 })]);
    expect(model.paidExtras).toEqual([expect.objectContaining({ name: "نقل من المطار", amount: 150 })]);
    expect(model.roomSubtotal).toBe(1800);
    expect(model.extrasTotal).toBe(150);
    expect(model.total).toBe(1950);
  });

  it("writes an Arabic WhatsApp proof with identity, plan and service detail", () => {
    const text = buildReservationProofText({
      property, booking, allocations, charges, locale: "ar", sourceLabel: "واتساب",
    });
    expect(text).toContain("PH-2608-0012");
    expect(text).toContain("A12345678");
    expect(text).toContain("شركة — فطار");
    expect(text).toContain("شركة النور");
    expect(text).toContain("فطار × ٩");
    expect(text).toContain("نقل من المطار × ١ — ١٥٠ ج");
    expect(text).toContain("سعر الإقامة: ١٬٨٠٠ ج");
    expect(text).not.toContain("سطر ملغي");
  });

  it("uses English snapshots and room types for an English proof", () => {
    const text = buildReservationProofText({
      property, booking, allocations, charges, locale: "en", sourceLabel: "WhatsApp",
    });
    expect(text).toContain("Palm Hotel");
    expect(text).toContain("Corporate B&B");
    expect(text).toContain("204 — Deluxe");
    expect(text).toContain("Breakfast × 9");
    expect(text).toContain("Total: 1,950 EGP");
  });

  it("keeps checked-out rooms but drops a room cancelled from the booking", () => {
    const model = reservationProofModel({
      booking,
      allocations: [
        { ...allocations[0], released_at: "2026-08-28T10:00:00Z", release_reason: null },
        { ...allocations[0], rooms: { number: "205" }, release_reason: "إلغاء جزئي" },
      ],
      charges,
      locale: "ar",
    });
    expect(model.rooms.map((room) => room.number)).toEqual(["204"]);
  });
});
