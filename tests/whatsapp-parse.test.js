import { describe, expect, it } from "vitest";
import {
  findDates, findName, findNights, findPax, findPhone, findRooms,
  fold, isWorthReviewing, parseMessage, toWesternDigits, uncertainFields,
} from "../lib/whatsapp-parse";

// A Saturday, so every weekday case below has a known answer.
const TODAY = "2026-08-15";
const read = (text) => parseMessage(text, { today: TODAY });
const value = (field) => field?.value ?? null;

describe("reading the digits and letters people actually type", () => {
  it("treats Arabic-Indic digits as the numbers they are", () => {
    expect(toWesternDigits("٢٠٢٦")).toBe("2026");
    expect(toWesternDigits("۰۱۱۱۸۰۷۰۴۵۳")).toBe("01118070453");
    expect(toWesternDigits("من ٥ ل ٨")).toBe("من 5 ل 8");
  });

  it("folds the spellings of one word into one", () => {
    expect(fold("أغسطس")).toBe(fold("اغسطس"));
    expect(fold("غُرْفَة")).toBe("غرفه");
    expect(fold("الجمعة")).toBe("الجمعه");
  });
});

describe("dates", () => {
  const dates = (text) => findDates(text, TODAY).map((d) => d.iso);

  it("reads a range that names its month once at the end", () => {
    // The single most common shape a message takes here.
    expect(dates("عايز احجز من 20 لـ 23 اغسطس")).toEqual(["2026-08-20", "2026-08-23"]);
    expect(dates("من ٥ ل ٨ سبتمبر")).toEqual(["2026-09-05", "2026-09-08"]);
  });

  it("reads a range where each end names its own month", () => {
    expect(dates("from 30 August to 2 September")).toEqual(["2026-08-30", "2026-09-02"]);
  });

  it("reads numeric dates day-first, the way they are written here", () => {
    expect(dates("5/9")).toEqual(["2026-09-05"]);
    expect(dates("من 12/9 لحد 15/9")).toEqual(["2026-09-12", "2026-09-15"]);
    expect(dates("20-08-2026")).toEqual(["2026-08-20"]);
  });

  it("rolls a month that has already gone into next year", () => {
    // Asked in August about March: the guest means next March.
    expect(dates("3 مارس")).toEqual(["2027-03-03"]);
    // But a stay that started a few days ago is a real thing, not next year.
    expect(dates("12 اغسطس")).toEqual(["2026-08-12"]);
  });

  it("reads today, tomorrow and the day after", () => {
    expect(dates("النهاردة")).toEqual([TODAY]);
    expect(dates("بكرة")).toEqual(["2026-08-16"]);
    expect(dates("بعد بكرة")).toEqual(["2026-08-17"]);
    expect(dates("tomorrow")).toEqual(["2026-08-16"]);
  });

  it("reads a weekday as the next one to come", () => {
    // 15 Aug 2026 is a Saturday.
    expect(dates("الخميس الجاي")).toEqual(["2026-08-20"]);
    expect(dates("next thursday")).toEqual(["2026-08-20"]);
    // Naming the day it already is means the one a week away.
    expect(dates("السبت")).toEqual(["2026-08-22"]);
  });

  it("marks a weekday as a guess and a written date as certain", () => {
    expect(findDates("الخميس الجاي", TODAY)[0].sure).toBe(false);
    expect(findDates("20 اغسطس", TODAY)[0].sure).toBe(true);
  });

  it("refuses a day that does not exist rather than sliding it", () => {
    expect(dates("31 سبتمبر")).toEqual([]);
    expect(dates("30/2")).toEqual([]);
  });

  it("does not read every number in a message as a date", () => {
    expect(dates("عايز غرفة لـ 4 افراد")).toEqual([]);
    expect(dates("01118070453")).toEqual([]);
  });
});

describe("how many, and for how long", () => {
  it("reads nights written as a number or as a word", () => {
    expect(value(findNights("3 ليالي"))).toBe(3);
    expect(value(findNights("تلات ليالي"))).toBe(3);
    expect(value(findNights("4 nights"))).toBe(4);
    expect(value(findNights("ليلة واحدة"))).toBe(1);
  });

  it("reads the Arabic dual, which is how two is written", () => {
    expect(value(findNights("ليلتين"))).toBe(2);
    expect(value(findPax("شخصين"))).toBe(2);
    expect(value(findRooms("غرفتين"))).toBe(2);
  });

  it("reads a week as seven nights", () => {
    expect(value(findNights("اسبوع"))).toBe(7);
    expect(value(findNights("اسبوعين"))).toBe(14);
  });

  it("counts people however they are described", () => {
    expect(value(findPax("٤ افراد"))).toBe(4);
    expect(value(findPax("2 adults"))).toBe(2);
    expect(value(findPax("عايز اجي لوحدي"))).toBe(1);
  });

  it("takes a plain mention of a room as one room", () => {
    expect(value(findRooms("عايز احجز غرفة"))).toBe(1);
    expect(value(findRooms("3 غرف"))).toBe(3);
    expect(value(findRooms("a double room"))).toBe(1);
  });

  it("does not let a room count swallow the nights next to it", () => {
    const draft = read("غرفة 3 ليالي");
    expect(value(draft.rooms)).toBe(1);
    expect(value(draft.nights)).toBe(3);
  });

  it("reads a word carrying the definite article joined on", () => {
    // Most messages write it this way, and a bare-word rule misses them all.
    expect(value(findRooms("عايز نفس الغرفة"))).toBe(1);
    expect(value(findRooms("الغرفتين اللي فوق"))).toBe(2);
    expect(value(findPax("6 الافراد"))).toBe(6);
  });

  it("does not read a price question as a one-night stay", () => {
    // "سعر الليلة كام" is a question about money, not a booking for a night.
    expect(findNights("ممكن اعرف السعر لليلة الواحدة؟")).toBeNull();
    expect(findNights("الغرفة بكام في الليلة؟")).toBeNull();
  });

  it("says nothing when the message says nothing", () => {
    expect(findNights("السلام عليكم")).toBeNull();
    expect(findPax("السلام عليكم")).toBeNull();
    expect(findRooms("السلام عليكم")).toBeNull();
  });
});

describe("who is asking", () => {
  it("takes a phone number as the sender wrote it", () => {
    expect(value(findPhone("رقمي 01118070453"))).toBe("01118070453");
    expect(value(findPhone("۰۱۰۰۱۲۳۴۵۶۷"))).toBe("01001234567");
    expect(value(findPhone("+49 30 901820"))).toBe("+4930901820");
  });

  it("does not mistake a date or a price for a phone number", () => {
    expect(findPhone("من 20 لـ 23 اغسطس")).toBeNull();
    expect(findPhone("600 جنيه")).toBeNull();
  });

  it("takes a name the message announces", () => {
    expect(value(findName("الاسم احمد محمود"))).toBe("احمد محمود");
    expect(value(findName("الحجز باسم مروة"))).toBe("مروة");
    expect(value(findName("my name is Sarah Whitfield"))).toBe("Sarah Whitfield");
  });

  it("leaves the name empty rather than guessing one", () => {
    // A greeting is not a name, and a booking filed under "السلام عليكم"
    // is worse than an empty box reception fills in.
    expect(findName("السلام عليكم عايز احجز")).toBeNull();
    expect(findName("Hi, do you have a room?")).toBeNull();
    // A "name" line carrying only a number is the phone number.
    expect(findName("الاسم 01118070453")).toBeNull();
  });
});

describe("whole messages, as they arrive", () => {
  it("reads the ordinary Arabic booking message", () => {
    const draft = read(`السلام عليكم
عايز احجز غرفة من 20 لـ 23 اغسطس
شخصين
الاسم احمد محمود
01118070453`);

    expect(value(draft.name)).toBe("احمد محمود");
    expect(value(draft.phone)).toBe("01118070453");
    expect(value(draft.checkIn)).toBe("2026-08-20");
    expect(value(draft.checkOut)).toBe("2026-08-23");
    expect(value(draft.nights)).toBe(3);
    expect(value(draft.pax)).toBe(2);
    expect(value(draft.rooms)).toBe(1);
    expect(uncertainFields(draft)).toEqual([]);
  });

  it("reads the English one", () => {
    const draft = read("Hi, do you have a double room from 5 to 8 September for 2 people? Thanks");
    expect(value(draft.checkIn)).toBe("2026-09-05");
    expect(value(draft.checkOut)).toBe("2026-09-08");
    expect(value(draft.pax)).toBe(2);
    expect(value(draft.rooms)).toBe(1);
    expect(draft.name).toBeNull();
  });

  it("works out the departure from a start and a length", () => {
    const draft = read("متاح عندكم غرفة ٣ ليالي من يوم الخميس الجاي؟ ٤ افراد");
    expect(value(draft.checkIn)).toBe("2026-08-20");
    expect(value(draft.checkOut)).toBe("2026-08-23");
    expect(value(draft.pax)).toBe(4);
    // The whole stay rests on a weekday, so both ends are worth checking.
    expect(uncertainFields(draft)).toEqual(["checkIn", "checkOut"]);
  });

  it("reads a message with nothing but dates in it", () => {
    const draft = read("من ١٢/٩ لحد ١٥/٩، غرفتين");
    expect(value(draft.checkIn)).toBe("2026-09-12");
    expect(value(draft.checkOut)).toBe("2026-09-15");
    expect(value(draft.rooms)).toBe(2);
    expect(value(draft.nights)).toBe(3);
  });

  it("puts a range written backwards the right way round", () => {
    const draft = read("من 23 لـ 20 اغسطس");
    expect(value(draft.checkIn)).toBe("2026-08-20");
    expect(value(draft.checkOut)).toBe("2026-08-23");
  });

  it("leaves the departure empty rather than inventing a length", () => {
    const draft = read("عايز اجي يوم 20 اغسطس");
    expect(value(draft.checkIn)).toBe("2026-08-20");
    expect(draft.checkOut).toBeNull();
    expect(draft.nights).toBeNull();
  });

  it("returns an empty draft for a message that is not a booking", () => {
    const draft = read("شكراً جداً، الإقامة كانت ممتازة");
    expect(Object.values(draft).every((field) => field === null)).toBe(true);
    expect(isWorthReviewing(draft)).toBe(false);
  });

  it("copes with an empty message without throwing", () => {
    for (const input of ["", null, undefined, "   "]) {
      expect(() => parseMessage(input, { today: TODAY })).not.toThrow();
    }
  });

  it("knows when it has found enough to be worth showing", () => {
    expect(isWorthReviewing(read("من 20 لـ 23 اغسطس"))).toBe(true);
    expect(isWorthReviewing(read("رقمي 01118070453"))).toBe(true);
    expect(isWorthReviewing(read("ازيك عامل ايه"))).toBe(false);
  });
});
