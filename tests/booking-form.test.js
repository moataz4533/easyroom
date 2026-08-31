import { describe, expect, it } from "vitest";
import {
  PASS_FIELDS, PASS_LOCALES, PASS_SECTIONS, bookingFormModel, bookingFormText,
  isCurrentStay, manualForm, manualModel, manualProblem, nightsLine, partyLine,
  passDate, passGaps, passText, passValues, passWords, passableBooking, roomsLine,
} from "../lib/booking-form";

const property = {
  name: "نادي اليونانيين",
  name_en: "The Greek Club",
  logo_url: "https://example.test/logo.png",
  settings: { address: "دهب، جنوب سيناء", phone: "0100 000 0000" },
};

const booking = {
  reference: "GR26-0042",
  status: "confirmed",
  check_in: "2026-08-12",
  check_out: "2026-08-15",
  adults: 2,
  children: 1,
  guests: {
    full_name: "محمود أحمد جمعة",
    phone: "01201965659",
    id_number: "30111052503613",
    nationality: "مصري",
  },
};

const allocations = [
  { id: "a", occupancy: 3, rooms: { number: "4", room_types: { name: "غرفة تريبل", name_en: "Triple" } } },
  { id: "b", occupancy: 2, released_at: "2026-08-01", release_reason: "cancelled",
    rooms: { number: "5", room_types: { name: "غرفة دبل", name_en: "Double" } } },
];

describe("bookingFormModel", () => {
  const model = bookingFormModel({ property, booking, allocations, issuedOn: "2026-08-09" });

  it("keeps only the rooms the booking still holds", () => {
    expect(model.rooms.map((room) => room.number)).toEqual(["4"]);
    expect(model.roomCount).toBe(1);
  });

  it("carries the guest identity the paper is built around", () => {
    expect(model.guest).toBe("محمود أحمد جمعة");
    expect(model.idNumber).toBe("30111052503613");
    expect(model.nationality).toBe("مصري");
    expect(model.nights).toBe(3);
  });

  it("takes the larger party count so the paper never lists fewer people than the car", () => {
    expect(model.party).toBe(3);
    const roomier = bookingFormModel({
      property, booking: { ...booking, adults: 1, children: 0 }, allocations,
    });
    expect(roomier.party).toBe(3);
    const typed = bookingFormModel({
      property, booking: { ...booking, adults: 4, children: 2 }, allocations,
    });
    expect(typed.party).toBe(6);
  });

  it("never carries money", () => {
    const withMoney = { ...booking, total_amount: 5400, paid_amount: 1800 };
    const priced = bookingFormModel({ property, booking: withMoney, allocations });
    const serialised = JSON.stringify(priced);
    expect(serialised).not.toContain("5400");
    expect(serialised).not.toContain("1800");
    expect(Object.keys(priced)).not.toContain("total");
  });

  it("puts the hotel's English name on the letterhead, in either language", () => {
    expect(model.hotel.brand).toBe("The Greek Club");
    const arabicOnly = bookingFormModel({
      property: { ...property, name_en: "" }, booking, allocations,
    });
    expect(arabicOnly.hotel.brand).toBe("نادي اليونانيين");
  });

  it("reads the rest of the letterhead off the property", () => {
    expect(model.hotel.logo).toBe("https://example.test/logo.png");
    expect(model.hotel.address).toBe("دهب، جنوب سيناء");
    expect(model.hotel.phone).toBe("0100 000 0000");
  });

  it("falls back to the WhatsApp number when no phone is recorded", () => {
    const other = bookingFormModel({
      property: { ...property, settings: { address: "x", whatsapp: "0111" } }, booking, allocations,
    });
    expect(other.hotel.phone).toBe("0111");
  });
});

describe("passGaps", () => {
  it("is silent when everything the paper needs is on file", () => {
    expect(passGaps(bookingFormModel({ property, booking, allocations }))).toEqual([]);
  });

  it("names the missing guest ID", () => {
    const model = bookingFormModel({
      property, booking: { ...booking, guests: { ...booking.guests, id_number: "" } }, allocations,
    });
    expect(passGaps(model)).toContain("idNumber");
  });

  it("names a hotel with nothing to contact it by", () => {
    const model = bookingFormModel({ property: { ...property, settings: {} }, booking, allocations });
    expect(passGaps(model)).toEqual(expect.arrayContaining(["hotelPhone", "hotelAddress"]));
  });
});

describe("passableBooking", () => {
  it("issues for a stay that is coming, running, or already over", () => {
    expect(passableBooking(booking)).toBe(true);
    expect(passableBooking({ ...booking, status: "checked_in" })).toBe(true);
    // Guests ask for the paper after they get home as often as before.
    expect(passableBooking({ ...booking, status: "checked_out" })).toBe(true);
  });

  it("refuses a stay that never happened", () => {
    expect(passableBooking({ ...booking, status: "cancelled" })).toBe(false);
    expect(passableBooking({ ...booking, status: "no_show" })).toBe(false);
    expect(passableBooking(null)).toBe(false);
  });
});

describe("isCurrentStay", () => {
  it("keeps a stay current until the day it ends", () => {
    expect(isCurrentStay(booking, "2026-08-10")).toBe(true);
    expect(isCurrentStay(booking, "2026-08-15")).toBe(true);
    expect(isCurrentStay(booking, "2026-08-16")).toBe(false);
    expect(isCurrentStay(null, "2026-08-10")).toBe(false);
  });
});

describe("the hand-typed form", () => {
  const filled = manualForm({
    guest: "Sara Halim", idNumber: "29901011234567", nationality: "Egyptian",
    phone: "01000000000", checkIn: "2026-09-01", checkOut: "2026-09-04",
    party: "2", rooms: "غرفة دبل", reference: "TMP-7",
  });

  it("starts empty and refuses to print until it can say who and when", () => {
    expect(manualProblem(manualForm())).toBe("needGuest");
    expect(manualProblem(manualForm({ guest: "Sara" }))).toBe("needDates");
    expect(manualProblem(manualForm({ guest: "Sara", checkIn: "2026-09-04", checkOut: "2026-09-01" })))
      .toBe("checkOutAfterCheckIn");
    expect(manualProblem(manualForm({ guest: "Sara", checkIn: "2026-09-01", checkOut: "2026-09-01" })))
      .toBe("checkOutAfterCheckIn");
    expect(manualProblem(filled)).toBe(null);
  });

  it("builds the same document a booking builds", () => {
    const model = manualModel({ property, form: filled, issuedOn: "2026-08-30" });
    const values = passValues(model, "en");
    expect(values.guest).toBe("Sara Halim");
    expect(values.checkIn).toBe("1 September 2026");
    expect(values.nights).toBe("3 nights");
    expect(values.party).toBe("2 guests");
    // The accommodation is printed exactly as typed, in either language.
    expect(values.rooms).toBe("غرفة دبل");
    expect(passValues(model, "ar").rooms).toBe("غرفة دبل");
    expect(model.hotel.brand).toBe("The Greek Club");
  });

  it("still warns about a missing ID typed by hand", () => {
    const model = manualModel({ property, form: { ...filled, idNumber: "" } });
    expect(passGaps(model)).toContain("idNumber");
  });

  it("never lists fewer than one guest", () => {
    expect(manualModel({ property, form: { ...filled, party: "0" } }).party).toBe(1);
    expect(manualModel({ property, form: { ...filled, party: "" } }).party).toBe(1);
  });

  it("carries no money, like every other route to this paper", () => {
    const model = manualModel({ property, form: { ...filled, total_amount: 5400 } });
    expect(JSON.stringify(model)).not.toContain("5400");
  });

  it("prints without a reference rather than trailing a dash", () => {
    const model = manualModel({ property, form: { ...filled, reference: "" } });
    const text = passText(model, "en");
    expect(text).toContain(passWords("en").title);
    expect(text).not.toContain("— \n");
    expect(text.split("\n")[1].trim()).toBe(passWords("en").title);
  });
});

describe("passDate", () => {
  it("spells the month out, so no reader can take it day-first or month-first", () => {
    expect(passDate("2026-08-12", "en")).toBe("12 August 2026");
    expect(passDate("2026-08-12", "ar")).toContain("أغسطس");
  });

  it("uses Western digits even in Arabic", () => {
    const arabic = passDate("2026-08-12", "ar");
    expect(arabic).toContain("12");
    expect(arabic).toContain("2026");
    expect(arabic).not.toMatch(/[٠-٩]/);
  });

  it("survives a missing or odd value", () => {
    expect(passDate(null, "en")).toBe("");
    expect(passDate("soon", "en")).toBe("soon");
  });
});

describe("the document's two languages", () => {
  it("has every printed word in both", () => {
    for (const locale of PASS_LOCALES) {
      const w = passWords(locale);
      for (const key of [...PASS_FIELDS, "title", "reference", "issuedOn", "statement", "stamp", "missing"]) {
        expect(w[key], `${locale}.${key}`).toBeTruthy();
      }
      for (const section of PASS_SECTIONS) expect(w[section.key], section.key).toBeTruthy();
    }
  });

  it("says nothing about why the paper was issued", () => {
    for (const locale of PASS_LOCALES) {
      const printed = Object.values(passWords(locale)).join(" ");
      // Whole words only — "Passport / ID no." is an ordinary voucher line
      // and must not trip a search for "pass".
      for (const word of ["كمين", "كمائن", "تصريح", "مرور", "checkpoint", "pass", "permit", "certificate"]) {
        expect(printed, word).not.toMatch(new RegExp(`(^|\\P{L})${word}(\\P{L}|$)`, "iu"));
      }
    }
  });

  it("falls back to English for a language the document does not speak", () => {
    expect(passWords("ru").title).toBe(passWords("en").title);
  });
});

describe("printed values", () => {
  const model = bookingFormModel({ property, booking, allocations, issuedOn: "2026-08-09" });

  it("names the room in the document's own language", () => {
    expect(roomsLine(model, "en")).toBe("4 — Triple");
    expect(roomsLine(model, "ar")).toBe("غرفة تريبل — 4");
  });

  it("writes counts as words, not bare numbers", () => {
    expect(nightsLine(3, "en")).toBe("3 nights");
    expect(nightsLine(1, "en")).toBe("1 night");
    expect(partyLine(1, "ar")).toBe("1 فرد");
    expect(partyLine(3, "ar")).toBe("3 أفراد");
  });

  it("fills every field the document lays out", () => {
    const values = passValues(model, "en");
    for (const field of PASS_FIELDS) expect(values[field], field).toBeTruthy();
  });
});

describe("buildBookingFormText", () => {
  const text = bookingFormText({
    property, booking, allocations, issuedOn: "2026-08-09", locale: "en",
  });

  it("leads with the hotel's name and carries the stay", () => {
    expect(text).toContain("The Greek Club");
    expect(text).toContain("GR26-0042");
    expect(text).toContain("30111052503613");
    expect(text).toContain("12 August 2026");
    expect(text).toContain("0100 000 0000");
  });

  it("carries no money", () => {
    const priced = bookingFormText({
      property, booking: { ...booking, total_amount: 5400, paid_amount: 1800 }, allocations, locale: "en",
    });
    expect(priced).not.toContain("5400");
    expect(priced).not.toContain("1800");
  });

  it("marks a blank field instead of leaving a hole", () => {
    const bare = bookingFormText({
      property, booking: { ...booking, guests: { full_name: "زائر" } }, allocations, locale: "ar",
    });
    expect(bare).toContain(passWords("ar").missing);
  });

  it("drops the contact line when the hotel has no contact on file", () => {
    const bare = bookingFormText({
      property: { ...property, settings: {} }, booking, allocations, locale: "en",
    });
    expect(bare).not.toContain("دهب");
    expect(bare).not.toContain("0100");
  });

  it("writes the whole thing in the language it was asked for", () => {
    const arabic = bookingFormText({ property, booking, allocations, locale: "ar" });
    expect(arabic).toContain(passWords("ar").title);
    expect(arabic).not.toContain(passWords("en").title);
  });
});
