import { describe, expect, it } from "vitest";
import {
  ageOn, buildGuestCsv, csvFilename, describeGuest, implausibleFields, isComplete,
  liveRoomNumbers, missingFields, needsAttention, recordIssueCount,
} from "../lib/guest-record";

const complete = {
  full_name: "Sarah Whitfield", phone: "+201001234567",
  nationality: "بريطاني", id_number: "P1234567", date_of_birth: "1991-03-04",
};

const stay = {
  reference: "GC-2608-0042", check_in: "2026-08-14", check_out: "2026-08-17",
  guests: complete,
  room_allocations: [
    { released_at: null, rooms: { number: "101" } },
    { released_at: "2026-08-12T10:00:00Z", rooms: { number: "104" } },
  ],
};

describe("what a record needs before it counts", () => {
  it("accepts a record with nationality, ID and date of birth", () => {
    expect(isComplete(complete)).toBe(true);
    expect(missingFields(complete)).toEqual([]);
  });

  it("names what is missing, in the reader's language", () => {
    const bare = { full_name: "أحمد" };
    expect(missingFields(bare, "ar")).toEqual(["الجنسية", "رقم الإثبات", "تاريخ الميلاد"]);
    expect(missingFields(bare, "en")).toEqual(["Nationality", "ID number", "Date of birth"]);
  });

  it("treats blank space as missing, not as filled in", () => {
    expect(isComplete({ ...complete, id_number: "   " })).toBe(false);
    expect(isComplete(null)).toBe(false);
  });

  it("summarises what has been recorded so far", () => {
    expect(describeGuest(complete, "en")).toContain("P1234567");
    expect(describeGuest({}, "en")).toBe("");
  });
});

describe("the exported file", () => {
  it("starts with a BOM so Excel reads the Arabic", () => {
    expect(buildGuestCsv([stay], "ar").startsWith("﻿")).toBe(true);
  });

  it("writes a header and one line per stay", () => {
    const lines = buildGuestCsv([stay], "en").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Reference"');
    expect(lines[1]).toContain('"GC-2608-0042"');
    expect(lines[1]).toContain('"Sarah Whitfield"');
    expect(lines[1]).toContain('"1991-03-04"');
  });

  it("lists only the rooms still held, not released ones", () => {
    expect(liveRoomNumbers(stay)).toEqual(["101"]);
    expect(buildGuestCsv([stay], "en")).not.toContain("104");
  });

  it("quotes a name containing a comma or a quote instead of splitting the row", () => {
    const tricky = { ...stay, guests: { ...complete, full_name: 'Smith, John "JJ"' } };
    const line = buildGuestCsv([tricky], "en").trim().split("\r\n")[1];
    expect(line).toContain('"Smith, John ""JJ"""');
    expect(line.split('","')).toHaveLength(9);
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    const injected = { ...stay, guests: { ...complete, full_name: "=1+1" } };
    expect(buildGuestCsv([injected], "en")).toContain(`"'=1+1"`);
  });

  it("still produces a valid empty file for a period with nobody in it", () => {
    const csv = buildGuestCsv([], "ar");
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("names the file after the period it covers", () => {
    expect(csvFilename("2026-08-01", "2026-08-31")).toBe("easyroom-guests-2026-08-01-2026-08-31.csv");
  });
});

describe("age", () => {
  it("counts the birthday that has not happened yet as a year less", () => {
    expect(ageOn("1991-03-04", "2026-08-14")).toBe(35);
    expect(ageOn("1991-09-04", "2026-08-14")).toBe(34);
    expect(ageOn("1991-08-14", "2026-08-14")).toBe(35);
  });

  it("returns nothing rather than a wrong number", () => {
    expect(ageOn(null, "2026-08-14")).toBeNull();
    expect(ageOn("not-a-date", "2026-08-14")).toBeNull();
  });
});

describe("a field that is filled in and still wrong", () => {
  const today = "2026-08-15";
  const messages = (guest, locale = "ar") =>
    implausibleFields(guest, locale, { today }).map((f) => f.message);
  const fields = (guest) =>
    implausibleFields(guest, "ar", { today }).map((f) => f.field);

  it("passes a real record without a word", () => {
    expect(implausibleFields(complete, "ar", { today })).toEqual([]);
  });

  it("says nothing about a field nobody has filled in yet", () => {
    // That is what missingFields is for; saying it twice is nagging.
    expect(implausibleFields({ full_name: "أحمد" }, "ar", { today })).toEqual([]);
    expect(implausibleFields(null, "ar", { today })).toEqual([]);
  });

  it("catches the two rows the live database actually has", () => {
    // A guest called hl[v on the phone number 123.
    expect(fields({ full_name: "hl[v", phone: "123" })).toEqual(["full_name", "phone"]);
  });

  it("questions a name that could not be a name", () => {
    expect(messages({ full_name: "x" })).toEqual(["الاسم حرف واحد فقط"]);
    expect(messages({ full_name: "12345" })).toEqual(["الاسم ليس فيه حروف"]);
    expect(messages({ full_name: "ahmed@@" })).toEqual(["الاسم فيه رموز غير معتادة"]);
  });

  it("leaves names that only look unusual to a form alone", () => {
    for (const full_name of [
      "محمد عبد الله", "Jean-Luc O'Brien", "Anna-Maria Müller",
      "N'Diaye", "Robert Downey Jr.", "李 明",
    ]) {
      expect(messages({ full_name })).toEqual([]);
    }
  });

  it("questions a phone number that could not reach anybody", () => {
    expect(fields({ phone: "123" })).toEqual(["phone"]);
    expect(messages({ phone: "0111111111111111111" })).toEqual(["رقم الهاتف طويل جداً"]);
    expect(messages({ phone: "1111111111" })).toEqual(["رقم الهاتف رقم واحد مكرر"]);
  });

  it("accepts the shapes real numbers arrive in", () => {
    for (const phone of [
      "01118070453", "+201118070453", "0020 111 807 0453",
      "+49 30 901820", "+7 495 123-45-67", "0111-807-0453",
    ]) {
      expect(messages({ phone })).toEqual([]);
    }
  });

  it("questions an ID shorter than any real document", () => {
    expect(messages({ id_number: "111" })).toEqual(["رقم الإثبات قصير جداً"]);
    expect(messages({ id_number: "00000000000000" })).toEqual(["رقم الإثبات رقم واحد مكرر"]);
    expect(messages({ id_number: "A123456" })).toEqual([]);
    // Written with the separators people write them with.
    expect(messages({ id_number: "298 0304 01234 5" })).toEqual([]);
  });

  it("questions a birth date that cannot belong to a guest", () => {
    expect(messages({ date_of_birth: "2027-01-01" })).toEqual(["تاريخ الميلاد في المستقبل"]);
    expect(messages({ date_of_birth: "1890-01-01" })).toEqual(["تاريخ الميلاد يعني عمراً فوق ١٢٠ سنة"]);
    expect(messages({ date_of_birth: "not-a-date" })).toEqual(["تاريخ الميلاد غير مقروء"]);
    expect(messages({ date_of_birth: "1930-01-01" })).toEqual([]);
    // A baby in the family is a guest and gets a record like anyone else.
    expect(messages({ date_of_birth: "2026-06-01" })).toEqual([]);
  });

  it("questions an address that is not one", () => {
    expect(messages({ email: "sarah" })).toEqual(["البريد الإلكتروني ناقص"]);
    expect(messages({ email: "sarah@localhost" })).toEqual(["البريد الإلكتروني ناقص"]);
    expect(messages({ email: "sarah@example.co.uk" })).toEqual([]);
  });

  it("names the field in the reader's language", () => {
    const [issue] = implausibleFields({ phone: "123" }, "en", { today });
    expect(issue).toMatchObject({ field: "phone", label: "Phone" });
    expect(issue.message).toBe("the phone number is too short to be one");
  });

  it("counts missing and implausible together, because it is one job", () => {
    // Three required fields blank, plus a phone number that is not one.
    expect(recordIssueCount({ full_name: "أحمد", phone: "123" })).toBe(4);
    expect(recordIssueCount(complete)).toBe(0);
    expect(needsAttention(complete)).toBe(false);
    expect(needsAttention({ ...complete, phone: "123" })).toBe(true);
  });
});
