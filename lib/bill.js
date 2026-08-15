/**
 * The bill the guest is handed on the way out.
 *
 * Reception had nothing to give anybody. The booking screen shows a total
 * and a balance, but a guest asking "what am I paying for" needs the lines:
 * which room, how many nights, at what, what was added, what was paid.
 *
 * Built from the same rows the booking screen already loaded, so it costs no
 * connection and cannot disagree with the screen it was opened from. Pure,
 * because a bill that does not add up is worse than no bill.
 */

import { countNights, formatDate, formatNumber } from "./format";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * `allocations` are the booking's room_allocations rows with rooms(number).
 * A released allocation with no reason is a completed stay and still belongs
 * on the bill; one released with a reason was cancelled off it.
 */
export function billableRooms(allocations) {
  return (allocations || []).filter((a) => !a.release_reason);
}

/**
 * The allocation columns this file reads. The rows come from whichever
 * screen opened the bill, so its select list has to carry all of these —
 * and the bill shipped pricing every room at zero because one of them was
 * missing and `undefined` read as "free" rather than as a mistake.
 */
export const BILL_ALLOCATION_FIELDS = [
  "starts_on", "ends_on", "rate_per_night", "release_reason",
  "discount_kind", "discount_value", "discount_amount",
];

export function roomLines(allocations, locale = "ar") {
  return billableRooms(allocations).map((a) => {
    // A rate that was never loaded is not a rate of zero. Saying so here is
    // the difference between a wrong bill handed to a guest and an error.
    if (a.rate_per_night === undefined) {
      throw new Error("the bill was given an allocation with no rate_per_night on it");
    }
    const nights = countNights(a.starts_on, a.ends_on);
    const rate = money(a.rate_per_night);
    const total = money(rate * nights);
    // A discount the guest was given is shown, not folded away: the price
    // they were quoted has to be on the paper next to what they saved, or
    // the favour was done and nobody knows it.
    const discount = money(a.discount_amount);
    return {
      room: a.rooms?.number || "—",
      from: a.starts_on,
      to: a.ends_on,
      nights,
      occupancy: Number(a.occupancy) || 0,
      rate,
      total,
      discount,
      // The price before the discount, derived from the two stored figures
      // so the three numbers on the line always agree.
      grossTotal: money(total + discount),
      grossRate: nights > 0 ? money((total + discount) / nights) : money(total + discount),
      discountKind: a.discount_kind || null,
      discountValue: a.discount_value === null || a.discount_value === undefined
        ? null : Number(a.discount_value),
      label: `${a.rooms?.number || "—"} · ${formatDate(a.starts_on, locale)} ← ${formatDate(a.ends_on, locale)}`,
    };
  });
}

/** What the whole bill saved the guest, for the one line that says so. */
export function billDiscount(allocations) {
  return money(roomLines(allocations).reduce((sum, line) => sum + line.discount, 0));
}

/** Voided lines are gone from the bill but never from the record. */
export function extraLines(charges) {
  return (charges || []).filter((c) => !c.voided_at).map((c) => ({
    description: c.description || "",
    quantity: Number(c.quantity) || 1,
    unit: money(c.unit_amount),
    total: money(c.amount ?? (Number(c.quantity) || 1) * money(c.unit_amount)),
  }));
}

/** A refund is a negative payment, so it subtracts here as it does everywhere. */
export function paymentLines(payments) {
  return [...(payments || [])]
    .sort((a, b) => String(a.received_at || "").localeCompare(String(b.received_at || "")))
    .map((p) => ({
      at: p.received_at,
      method: p.method,
      amount: money(p.amount),
      note: p.notes || "",
    }));
}

export function billTotals({ allocations, charges, payments }) {
  const lines = roomLines(allocations);
  const rooms = lines.reduce((sum, l) => sum + l.total, 0);
  const discount = lines.reduce((sum, l) => sum + l.discount, 0);
  const extras = extraLines(charges).reduce((sum, l) => sum + l.total, 0);
  const paid = paymentLines(payments).reduce((sum, l) => sum + l.amount, 0);
  const total = money(rooms + extras);
  return {
    rooms: money(rooms),
    discount: money(discount),
    extras: money(extras),
    total,
    paid: money(paid),
    balance: money(total - paid),
  };
}

const WORDS = {
  ar: {
    title: "بيان الحساب", booking: "رقم الحجز", guest: "النزيل",
    stay: "الإقامة", rooms: "الغرف", extras: "الإضافات", payments: "المدفوع",
    total: "الإجمالي", paid: "المحصّل", balance: "المتبقي", settled: "الحساب مسدد بالكامل",
    nights: "{n} ليلة", pax: "{n} أفراد", currency: "ج",
    discount: "خصم", saved: "وفّرت", percent: "٪", thanks: "شكراً لإقامتكم معنا.",
  },
  en: {
    title: "Statement of account", booking: "Booking", guest: "Guest",
    stay: "Stay", rooms: "Rooms", extras: "Extras", payments: "Payments",
    total: "Total", paid: "Paid", balance: "Balance", settled: "Paid in full",
    nights: "{n} nights", pax: "{n} guests", currency: "EGP",
    discount: "Discount", saved: "You saved", percent: "%", thanks: "Thank you for staying with us.",
  },
};

/**
 * The whole bill as plain text, so it can go on WhatsApp, be copied, or be
 * printed — the three things a guest actually asks for. Written in the
 * guest's language, which is not the language reception is working in.
 */
export function buildBillText({ property, booking, allocations, charges, payments, locale = "ar" }) {
  const w = WORDS[locale] || WORDS.ar;
  const n = (value) => formatNumber(value, locale);
  const cash = (value) => `${n(money(value))} ${w.currency}`;
  const totals = billTotals({ allocations, charges, payments });
  const out = [];

  const hotel = (locale === "en" ? property?.name_en : null) || property?.name || "";
  out.push(`*${w.title}*`);
  if (hotel.trim()) out.push(hotel.trim());
  out.push("");
  out.push(`${w.booking}: ${booking?.reference || "—"}`);
  out.push(`${w.guest}: ${booking?.guests?.full_name || "—"}`);
  out.push(`${w.stay}: ${formatDate(booking?.check_in, locale)} ← ${formatDate(booking?.check_out, locale)}`);
  out.push("");

  const rooms = roomLines(allocations, locale);
  if (rooms.length) {
    out.push(`*${w.rooms}*`);
    for (const line of rooms) {
      out.push(`${line.label}`);
      // With a discount the line is priced at what the room is sold for and
      // the discount shown underneath, so the guest can see both.
      out.push(`  ${w.nights.replace("{n}", n(line.nights))} × ${cash(line.grossRate)} = ${cash(line.grossTotal)}`);
      if (line.discount > 0) {
        const share = line.discountKind === "percent"
          ? ` ${n(line.discountValue)}${w.percent}` : "";
        out.push(`  ${w.discount}${share} − ${cash(line.discount)}`);
      }
    }
    out.push("");
  }

  const extras = extraLines(charges);
  if (extras.length) {
    out.push(`*${w.extras}*`);
    for (const line of extras) {
      out.push(line.quantity === 1
        ? `${line.description} — ${cash(line.total)}`
        : `${line.description} — ${n(line.quantity)} × ${cash(line.unit)} = ${cash(line.total)}`);
    }
    out.push("");
  }

  out.push(`*${w.total}: ${cash(totals.total)}*`);
  // Worth saying once at the bottom as well as line by line: with two rooms
  // discounted separately, nobody adds the two lines up in their head.
  if (totals.discount > 0) out.push(`${w.saved}: ${cash(totals.discount)}`);

  const paid = paymentLines(payments);
  if (paid.length) {
    out.push("");
    out.push(`*${w.payments}*`);
    for (const line of paid) {
      out.push(`${formatDate(line.at, locale)} — ${cash(line.amount)}`);
    }
    out.push(`${w.paid}: ${cash(totals.paid)}`);
  }

  out.push("");
  out.push(totals.balance > 0
    ? `*${w.balance}: ${cash(totals.balance)}*`
    : `*${w.settled}*`);
  out.push("");
  out.push(w.thanks);

  return out.join("\n");
}
