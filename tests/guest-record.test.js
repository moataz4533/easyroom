import { describe, expect, it } from "vitest";
import {
  ageOn, buildGuestCsv, csvFilename, describeGuest, isComplete,
  liveRoomNumbers, missingFields,
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
