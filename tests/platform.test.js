import { describe, expect, it } from "vitest";
import {
  CODE_PATTERN, codeProblem, isDormant, membersOf, neverSignedIn, newHotelProblems,
  normaliseCode, platformTotals, resetProblem, staffAddressExample, suggestCode,
  summariseProperty,
} from "../lib/platform";

const members = [
  { id: "m1", property_id: "a", user_id: "u1", role: "owner", is_active: true,
    full_name: "Owner A", last_sign_in_at: "2026-08-14T09:00:00Z" },
  { id: "m2", property_id: "a", user_id: "u2", role: "reception", is_active: true,
    full_name: "Zeinab", last_sign_in_at: null },
  { id: "m3", property_id: "a", user_id: "u3", role: "reception", is_active: false,
    full_name: "Adel", last_sign_in_at: "2026-05-01T09:00:00Z" },
  { id: "m4", property_id: "b", user_id: "u4", role: "owner", is_active: true,
    full_name: "Owner B", last_sign_in_at: "2026-08-15T06:00:00Z" },
];

const properties = [
  { id: "a", slug: "hotel-a", name: "Hotel A", is_active: true, created_at: "2026-01-01",
    counts: { rooms: 6, bookings: 40, guests: 33, payments: 12 } },
  { id: "b", slug: "hotel-b", name: "Hotel B", is_active: false, created_at: "2026-06-01",
    counts: { rooms: 12 } },
];

describe("the branch code", () => {
  it("tidies what somebody types into what a code can be", () => {
    expect(normaliseCode("  Greek Club  ")).toBe("greek-club");
    expect(normaliseCode("النادي")).toBe("");
    expect(normaliseCode("Sea__View..Hotel")).toBe("sea-view-hotel");
    expect(normaliseCode("--dahab--")).toBe("dahab");
  });

  it("suggests one from the hotel's name, for the human to accept", () => {
    expect(suggestCode("Greek Club Dahab")).toBe("greek-club-dahab");
    expect(suggestCode("Blue Beach!!")).toBe("blue-beach");
  });

  it("refuses a code that could not carry a login address", () => {
    expect(codeProblem("")).toBe("empty");
    expect(codeProblem("ab")).toBe("short");
    expect(codeProblem("x".repeat(41))).toBe("long");
    // Arabic normalises away to nothing, which is "empty", not "bad".
    expect(codeProblem("النادي اليوناني")).toBe("empty");
  });

  it("fixes a fixable code rather than rejecting it", () => {
    expect(codeProblem("-Greek Club-")).toBeNull();
    expect(normaliseCode("-Greek Club-")).toBe("greek-club");
  });

  it("never produces a character a login address could not carry", () => {
    // This is why codeProblem checks no character rules: whatever is typed,
    // what comes out is made only of what the pattern allows. Length is the
    // one thing normalising does not fix, and codeProblem says so instead —
    // quietly cutting somebody's code down to 40 would be a worse surprise
    // than telling them it is too long.
    for (const typed of [
      "Greek Club", "  --sea view--  ", "Hotel #1 @ Dahab", "a.b_c d",
      "ALLCAPS", "خليط mixed نص", "123", "x".repeat(80),
    ]) {
      const code = normaliseCode(typed);
      expect(code, typed).toMatch(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(codeProblem("x".repeat(80))).toBe("long");
    // And once it is short enough, it matches the pattern the server enforces.
    expect(CODE_PATTERN.test(normaliseCode("Hotel #1 @ Dahab"))).toBe(true);
  });

  it("keeps the words the platform needs for itself", () => {
    expect(codeProblem("admin")).toBe("reserved");
    expect(codeProblem("staff")).toBe("reserved");
  });

  it("refuses one already in use, however it was typed", () => {
    expect(codeProblem("hotel-a", ["hotel-a"])).toBe("taken");
    expect(codeProblem("Hotel A", ["hotel-a"])).toBe("taken");
    expect(codeProblem("hotel-c", ["hotel-a", "hotel-b"])).toBeNull();
  });

  it("shows the address the code commits the hotel's staff to", () => {
    // The code cannot change later without locking every staff member out,
    // so this is shown while it is still being typed.
    expect(staffAddressExample("greek-club")).toBe("greek-club.ahmed@staff.easyroom.app");
    expect(staffAddressExample("Greek Club", "zeinab")).toBe("greek-club.zeinab@staff.easyroom.app");
    expect(staffAddressExample("")).toBe("");
  });
});

describe("opening a hotel", () => {
  const good = {
    name: "Hotel C", code: "hotel-c", ownerName: "Sara",
    ownerEmail: "sara@example.com", password: "longenough", again: "longenough",
  };

  it("accepts a complete one", () => {
    expect(newHotelProblems(good, ["hotel-a"])).toEqual([]);
  });

  it("names everything wrong at once rather than one at a time", () => {
    expect(newHotelProblems({}, [])).toEqual([
      "name", "code:empty", "ownerName", "ownerEmail", "password",
    ]);
  });

  it("catches a taken code and a mistyped password", () => {
    expect(newHotelProblems({ ...good, code: "hotel-a" }, ["hotel-a"])).toEqual(["code:taken"]);
    expect(newHotelProblems({ ...good, again: "different" })).toEqual(["mismatch"]);
    expect(newHotelProblems({ ...good, ownerEmail: "sara@localhost" })).toEqual(["ownerEmail"]);
  });
});

describe("the accounts", () => {
  it("lists a hotel's people with its owner first", () => {
    expect(membersOf(members, "a").map((m) => m.full_name)).toEqual(["Owner A", "Adel", "Zeinab"]);
    expect(membersOf(members, "b").map((m) => m.full_name)).toEqual(["Owner B"]);
  });

  it("spots an account that was made but never used", () => {
    // Almost always means the password never reached the person.
    expect(neverSignedIn(members[1])).toBe(true);
    expect(neverSignedIn(members[0])).toBe(false);
  });

  it("spots one nobody has signed into for a month", () => {
    expect(isDormant(members[2], "2026-08-15")).toBe(true);
    expect(isDormant(members[0], "2026-08-15")).toBe(false);
    // Never signed in is its own thing, not dormancy.
    expect(isDormant(members[1], "2026-08-15")).toBe(false);
  });
});

describe("what the panel shows", () => {
  it("summarises a hotel by what it has and who is in it", () => {
    expect(summariseProperty(properties[0], members)).toMatchObject({
      slug: "hotel-a", active: true, rooms: 6, bookings: 40, guests: 33,
      members: 3, activeMembers: 2, neverUsed: 1,
    });
    expect(summariseProperty(properties[0], members).owner.full_name).toBe("Owner A");
  });

  it("copes with a hotel that has nothing in it yet", () => {
    expect(summariseProperty(properties[1], members)).toMatchObject({
      slug: "hotel-b", active: false, rooms: 12, bookings: 0, guests: 0, members: 1,
    });
  });

  it("adds the platform up, counting live hotels apart from all hotels", () => {
    expect(platformTotals(properties, members)).toEqual({
      hotels: 2, liveHotels: 1, accounts: 4, activeAccounts: 3,
      neverUsed: 1, rooms: 18, bookings: 40,
    });
  });

  it("copes with an empty platform", () => {
    expect(platformTotals([], [])).toMatchObject({ hotels: 0, accounts: 0, rooms: 0 });
  });
});

/**
 * Emptying a hotel's register. The database refuses this for anyone who is
 * not a platform admin and for any code that is not the hotel's own; what
 * is checked here is that the operator is told which it is before they
 * press anything.
 */
describe("confirming a reset", () => {
  it("wants the code typed before it will do anything", () => {
    expect(resetProblem("", "greek-club-dahab")).toBe("needCode");
    expect(resetProblem("   ", "greek-club-dahab")).toBe("needCode");
  });

  it("refuses the code of a different hotel", () => {
    expect(resetProblem("hotel-b", "greek-club-dahab")).toBe("codeMismatch");
  });

  it("accepts the hotel's own code, however it was typed", () => {
    expect(resetProblem("greek-club-dahab", "greek-club-dahab")).toBeNull();
    expect(resetProblem("  Greek Club Dahab ", "greek-club-dahab")).toBeNull();
  });
});
