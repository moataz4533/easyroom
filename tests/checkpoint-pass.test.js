import { describe, expect, it } from "vitest";
import {
  PASS_FIELDS, PASS_LOCALES, PASS_SECTIONS, buildCheckpointPassText,
  checkpointPassModel, nightsLine, partyLine, passDate, passGaps, passValues,
  passWords, passableBooking, roomsLine,
} from "../lib/checkpoint-pass";

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

describe("checkpointPassModel", () => {
  const model = checkpointPassModel({ property, booking, allocations, issuedOn: "2026-08-09" });

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
    const roomier = checkpointPassModel({
      property, booking: { ...booking, adults: 1, children: 0 }, allocations,
    });
    expect(roomier.party).toBe(3);
    const typed = checkpointPassModel({
      property, booking: { ...booking, adults: 4, children: 2 }, allocations,
    });
    expect(typed.party).toBe(6);
  });

  it("never carries money", () => {
    const withMoney = { ...booking, total_amount: 5400, paid_amount: 1800 };
    const priced = checkpointPassModel({ property, booking: withMoney, allocations });
    const serialised = JSON.stringify(priced);
    expect(serialised).not.toContain("5400");
    expect(serialised).not.toContain("1800");
    expect(Object.keys(priced)).not.toContain("total");
  });

  it("puts the hotel's English name on the letterhead, in either language", () => {
    expect(model.hotel.brand).toBe("The Greek Club");
    const arabicOnly = checkpointPassModel({
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
    const other = checkpointPassModel({
      property: { ...property, settings: { address: "x", whatsapp: "0111" } }, booking, allocations,
    });
    expect(other.hotel.phone).toBe("0111");
  });
});

describe("passGaps", () => {
  it("is silent when everything the paper needs is on file", () => {
    expect(passGaps(checkpointPassModel({ property, booking, allocations }))).toEqual([]);
  });

  it("names the missing guest ID", () => {
    const model = checkpointPassModel({
      property, booking: { ...booking, guests: { ...booking.guests, id_number: "" } }, allocations,
    });
    expect(passGaps(model)).toContain("idNumber");
  });

  it("names a hotel with nothing to contact it by", () => {
    const model = checkpointPassModel({ property: { ...property, settings: {} }, booking, allocations });
    expect(passGaps(model)).toEqual(expect.arrayContaining(["hotelPhone", "hotelAddress"]));
  });
});

describe("passableBooking", () => {
  it("issues for a live stay that has not ended", () => {
    expect(passableBooking(booking, "2026-08-10")).toBe(true);
    expect(passableBooking({ ...booking, status: "checked_in" }, "2026-08-13")).toBe(true);
  });

  it("refuses a cancelled or finished stay", () => {
    expect(passableBooking({ ...booking, status: "cancelled" }, "2026-08-10")).toBe(false);
    expect(passableBooking({ ...booking, status: "checked_out" }, "2026-08-10")).toBe(false);
    expect(passableBooking(booking, "2026-08-20")).toBe(false);
    expect(passableBooking(null, "2026-08-10")).toBe(false);
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
  const model = checkpointPassModel({ property, booking, allocations, issuedOn: "2026-08-09" });

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

describe("buildCheckpointPassText", () => {
  const text = buildCheckpointPassText({
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
    const priced = buildCheckpointPassText({
      property, booking: { ...booking, total_amount: 5400, paid_amount: 1800 }, allocations, locale: "en",
    });
    expect(priced).not.toContain("5400");
    expect(priced).not.toContain("1800");
  });

  it("marks a blank field instead of leaving a hole", () => {
    const bare = buildCheckpointPassText({
      property, booking: { ...booking, guests: { full_name: "زائر" } }, allocations, locale: "ar",
    });
    expect(bare).toContain(passWords("ar").missing);
  });

  it("drops the contact line when the hotel has no contact on file", () => {
    const bare = buildCheckpointPassText({
      property: { ...property, settings: {} }, booking, allocations, locale: "en",
    });
    expect(bare).not.toContain("دهب");
    expect(bare).not.toContain("0100");
  });

  it("writes the whole thing in the language it was asked for", () => {
    const arabic = buildCheckpointPassText({ property, booking, allocations, locale: "ar" });
    expect(arabic).toContain(passWords("ar").title);
    expect(arabic).not.toContain(passWords("en").title);
  });
});
