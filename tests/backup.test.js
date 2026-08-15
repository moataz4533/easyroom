import { describe, expect, it } from "vitest";
import {
  backupFileName, daysSince, isBackup, isStale, problemWith, summarise,
} from "../lib/backup";

const good = {
  format: "easyroom-backup", version: 1, taken_at: "2026-08-15T10:00:00Z",
  data: {
    rooms: [{}, {}, {}, {}, {}, {}],
    guests: [{}, {}],
    bookings: [{}],
    room_allocations: [{}],
    payments: [],
    booking_charges: [],
    rates: [{}, {}],
    rate_seasons: [],
  },
};

describe("recognising a backup", () => {
  it("accepts one this app wrote", () => {
    expect(isBackup(good)).toBe(true);
    expect(problemWith(good)).toBeNull();
  });

  it("refuses anything else, so a wrong file cannot be mistaken for cover", () => {
    expect(isBackup(null)).toBe(false);
    expect(isBackup({ format: "something-else", data: {} })).toBe(false);
    expect(isBackup({ format: "easyroom-backup" })).toBe(false);
    expect(problemWith({ hello: "world" })).toBe("notBackup");
  });

  it("refuses a file with no rooms in it rather than saving a useless one", () => {
    // Saving it would reset the reminder and leave the hotel believing it
    // is covered, which is worse than saving nothing.
    expect(problemWith({ ...good, data: { ...good.data, rooms: [] } })).toBe("empty");
  });
});

describe("what came back", () => {
  it("counts each kind so the screen can show it", () => {
    expect(summarise(good)).toMatchObject({
      rooms: 6, guests: 2, bookings: 1, payments: 0, rates: 2,
    });
  });

  it("counts a missing table as none rather than throwing", () => {
    expect(summarise({ ...good, data: { rooms: [{}] } }).guests).toBe(0);
    expect(summarise({ bad: true })).toBeNull();
  });
});

describe("how old the last one is", () => {
  const now = Date.parse("2026-08-15T10:00:00Z");

  it("counts whole days", () => {
    expect(daysSince("2026-08-15T09:00:00Z", now)).toBe(0);
    expect(daysSince("2026-08-14T09:00:00Z", now)).toBe(1);
    expect(daysSince("2026-08-01T10:00:00Z", now)).toBe(14);
  });

  it("treats never taken as stale, which is the point", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale("not a date", now)).toBe(true);
    expect(daysSince(null)).toBeNull();
  });

  it("starts asking after a week", () => {
    expect(isStale("2026-08-12T10:00:00Z", now)).toBe(false);
    expect(isStale("2026-08-08T10:00:00Z", now)).toBe(true);
  });
});

describe("what the file is called", () => {
  it("says the hotel and the moment, and cannot break a file system", () => {
    expect(backupFileName("The Greek Club", "2026-08-15T10:30:00Z"))
      .toBe("The Greek Club backup 2026-08-15 10-30.json");
    expect(backupFileName('a/b:c*|', "2026-08-15T10:30:00Z"))
      .toBe("abc backup 2026-08-15 10-30.json");
  });
});
