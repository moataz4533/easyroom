import { describe, expect, it } from "vitest";
import {
  PASS_FIELDS, PASS_WORDS, buildCheckpointPassText, checkpointPassModel,
  passDate, passGaps, passStatement, passableBooking,
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

  it("carries the guest identity a checkpoint reads", () => {
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

  it("reads the hotel letterhead off the property", () => {
    expect(model.hotel.name).toBe("نادي اليونانيين");
    expect(model.hotel.nameEn).toBe("The Greek Club");
    expect(model.hotel.logo).toBe("https://example.test/logo.png");
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
  it("is silent when everything a checkpoint needs is on file", () => {
    expect(passGaps(checkpointPassModel({ property, booking, allocations }))).toEqual([]);
  });

  it("names the missing guest ID", () => {
    const model = checkpointPassModel({
      property, booking: { ...booking, guests: { ...booking.guests, id_number: "" } }, allocations,
    });
    expect(passGaps(model)).toContain("idNumber");
  });

  it("names a hotel with no number to verify against", () => {
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
  it("writes the form the checkpoint's own paper uses", () => {
    expect(passDate("2026-08-12")).toBe("12 / 08 / 2026");
  });

  it("survives a missing or odd value", () => {
    expect(passDate(null)).toBe("");
    expect(passDate("soon")).toBe("soon");
  });
});

describe("the bilingual document", () => {
  it("labels every field in both languages", () => {
    for (const field of PASS_FIELDS) {
      expect(PASS_WORDS[field].ar).toBeTruthy();
      expect(PASS_WORDS[field].en).toBeTruthy();
    }
  });

  it("names the hotel and the guest in each statement", () => {
    expect(passStatement("نادي اليونانيين", "محمود", { locale: "ar" })).toContain("نادي اليونانيين");
    expect(passStatement("نادي اليونانيين", "محمود", { locale: "ar" })).toContain("محمود");
    expect(passStatement("The Greek Club", "Mahmoud", { locale: "en" })).toContain("The Greek Club");
  });

  it("still reads when the hotel or the guest has no name", () => {
    expect(passStatement("", "", { locale: "ar" })).toContain("الفندق");
    expect(passStatement("", "", { locale: "en" })).toContain("the hotel");
  });
});

describe("buildCheckpointPassText", () => {
  const text = buildCheckpointPassText({ property, booking, allocations, issuedOn: "2026-08-09" });

  it("carries the identity, the stay and the number to call", () => {
    expect(text).toContain("GR26-0042");
    expect(text).toContain("30111052503613");
    expect(text).toContain("12 / 08 / 2026");
    expect(text).toContain("0100 000 0000");
  });

  it("says out loud that it holds no money", () => {
    expect(text).toContain(PASS_WORDS.noMoney.ar);
    const priced = buildCheckpointPassText({
      property, booking: { ...booking, total_amount: 5400, paid_amount: 1800 }, allocations,
    });
    expect(priced).not.toContain("5400");
    expect(priced).not.toContain("1800");
  });

  it("marks a blank field instead of leaving a hole", () => {
    const bare = buildCheckpointPassText({
      property, booking: { ...booking, guests: { full_name: "زائر" } }, allocations,
    });
    expect(bare).toContain(PASS_WORDS.missing.ar);
  });

  it("drops the verify line when there is no number to verify against", () => {
    const bare = buildCheckpointPassText({
      property: { ...property, settings: {} }, booking, allocations,
    });
    expect(bare).not.toContain(PASS_WORDS.verify.ar);
  });
});
