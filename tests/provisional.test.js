import { describe, expect, it } from "vitest";
import {
  FAILED, PENDING, SENT, conflictingProvisionals, countByState, failureKind,
  headCount, needsAttention, newProvisional, overlaps, provisionalArgs,
  roomNumbers, roomsHeldOn, roomsWantedByDrafts, sortProvisionals, validateProvisional,
} from "../lib/provisional";

const draft = {
  propertyId: "p1",
  guestName: "  سامي عبد الله  ",
  guestPhone: " +201001234567 ",
  guestIdNumber: " A1234567 ",
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  rooms: { r101: 2, r102: 3 },
  ratePlanId: "plan1",
  source: "phone",
  notes: " وصول متأخر ",
};

const make = (over = {}, id = "rec1") =>
  newProvisional({ ...draft, ...over }, { now: 1, id });

describe("recording one", () => {
  it("trims what reception typed and starts as pending", () => {
    const r = make();
    expect(r).toMatchObject({
      id: "rec1", state: "pending", error: null,
      guestName: "سامي عبد الله", guestPhone: "+201001234567",
      guestIdNumber: "A1234567", notes: "وصول متأخر",
    });
  });

  it("copies the rooms rather than sharing them with the screen", () => {
    const rooms = { r101: 2 };
    const r = newProvisional({ ...draft, rooms });
    rooms.r102 = 2;
    expect(Object.keys(r.rooms)).toEqual(["r101"]);
  });

  it("gives each record its own reference", () => {
    expect(newProvisional(draft).id).not.toBe(newProvisional(draft).id);
  });

  it("counts heads across the rooms", () => {
    expect(headCount(make())).toBe(5);
  });

  it("keeps the room numbers, because there is no connection to look them up", () => {
    expect(roomNumbers(make({ roomLabels: { r101: "101", r102: "102" } })))
      .toEqual(["101", "102"]);
    // Nothing to show is better than nothing at all.
    expect(roomNumbers(make())).toEqual(["r101", "r102"]);
  });
});

describe("what cannot be recorded at all", () => {
  it("accepts a complete draft", () => {
    expect(validateProvisional(make())).toEqual([]);
  });

  it("insists on a name, because a failed booking has to be called back", () => {
    expect(validateProvisional(make({ guestName: "   " }))).toContain("name");
  });

  it("insists on a room and on sane dates", () => {
    expect(validateProvisional(make({ rooms: {} }))).toContain("rooms");
    expect(validateProvisional(make({ checkOut: "2026-09-01" }))).toContain("dates");
    expect(validateProvisional(make({ checkOut: "2026-08-30" }))).toContain("dates");
  });

  it("does not insist on a phone number — a walk-in may not give one", () => {
    expect(validateProvisional(make({ guestPhone: "" }))).toEqual([]);
  });
});

describe("nights overlapping", () => {
  it("does not count the checkout morning as an overlap", () => {
    expect(overlaps(
      { checkIn: "2026-09-01", checkOut: "2026-09-04" },
      { checkIn: "2026-09-04", checkOut: "2026-09-06" },
    )).toBe(false);
  });

  it("catches a stay that swallows another", () => {
    expect(overlaps(
      { checkIn: "2026-09-01", checkOut: "2026-09-10" },
      { checkIn: "2026-09-03", checkOut: "2026-09-04" },
    )).toBe(true);
  });
});

describe("conflicts we already know about", () => {
  const a = make({}, "a");

  it("names the other provisional booking that wants the same room", () => {
    const b = make({ rooms: { r102: 2 }, checkIn: "2026-09-03", checkOut: "2026-09-05" }, "b");
    expect(conflictingProvisionals(a, [a, b]).map((x) => x.id)).toEqual(["b"]);
  });

  it("stays quiet when the rooms differ", () => {
    const b = make({ rooms: { r103: 2 } }, "b");
    expect(conflictingProvisionals(a, [a, b])).toEqual([]);
  });

  it("stays quiet when the nights do not touch", () => {
    const b = make({ checkIn: "2026-09-04", checkOut: "2026-09-06" }, "b");
    expect(conflictingProvisionals(a, [a, b])).toEqual([]);
  });

  it("ignores one that has already gone through", () => {
    const b = { ...make({}, "b"), state: SENT };
    expect(conflictingProvisionals(a, [a, b])).toEqual([]);
  });
});

describe("rooms another provisional booking already wants", () => {
  const drafts = [
    make({ rooms: { r101: 2 }, checkIn: "2026-09-01", checkOut: "2026-09-03" }, "a"),
    make({ rooms: { r102: 2 }, checkIn: "2026-09-10", checkOut: "2026-09-12" }, "b"),
    { ...make({ rooms: { r103: 2 } }, "c"), state: SENT },
  ];

  it("names only the ones whose nights touch", () => {
    expect([...roomsWantedByDrafts(drafts, "2026-09-02", "2026-09-04")]).toEqual(["r101"]);
    expect([...roomsWantedByDrafts(drafts, "2026-09-03", "2026-09-09")]).toEqual([]);
  });

  it("does not count one that already became a booking", () => {
    expect(roomsWantedByDrafts(drafts, "2026-09-01", "2026-09-04").has("r103")).toBe(false);
  });

  it("does not warn a record about itself while it is being edited", () => {
    expect(roomsWantedByDrafts(drafts, "2026-09-01", "2026-09-04", "a").has("r101")).toBe(false);
  });
});

describe("what the last saved data says is taken", () => {
  const allocations = [
    { room_id: "r101", starts_on: "2026-09-02", ends_on: "2026-09-05" },
    { room_id: "r103", starts_on: "2026-08-20", ends_on: "2026-09-01" },
    { room_id: "r104", starts_on: "2026-09-04", ends_on: "2026-09-06" },
  ];

  it("marks a room whose stay covers any of the nights", () => {
    expect([...roomsHeldOn(allocations, "2026-09-01", "2026-09-04")]).toEqual(["r101"]);
  });

  it("frees the room on its checkout morning", () => {
    // r103 leaves on the 1st, so the 1st is free; r104 arrives on the 4th,
    // which is this stay's own checkout morning.
    expect(roomsHeldOn(allocations, "2026-09-01", "2026-09-04").has("r103")).toBe(false);
    expect(roomsHeldOn(allocations, "2026-09-01", "2026-09-04").has("r104")).toBe(false);
  });

  it("says nothing when the dates make no sense", () => {
    expect(roomsHeldOn(allocations, "2026-09-04", "2026-09-01").size).toBe(0);
    expect(roomsHeldOn(allocations, null, null).size).toBe(0);
  });

  it("skips rows with nothing usable on them", () => {
    expect(roomsHeldOn([{ room_id: null }, {}], "2026-09-01", "2026-09-04").size).toBe(0);
  });
});

describe("sending it", () => {
  it("carries its own reference so a lost answer cannot book twice", () => {
    expect(provisionalArgs(make()).p_client_ref).toBe("rec1");
  });

  it("shapes the rooms the way the database expects", () => {
    expect(provisionalArgs(make()).p_rooms).toEqual([
      { room_id: "r101", occupancy: 2 },
      { room_id: "r102", occupancy: 3 },
    ]);
  });

  it("sends nothing rather than an empty phone number", () => {
    expect(provisionalArgs(make({ guestPhone: "" })).p_guest_phone).toBeNull();
    expect(provisionalArgs(make({ guestIdNumber: "" })).p_guest_id_number).toBeNull();
    expect(provisionalArgs(make({ notes: "" })).p_notes).toBeNull();
  });

  it("falls back to two guests if an occupancy went missing", () => {
    expect(provisionalArgs(make({ rooms: { r101: null } })).p_rooms)
      .toEqual([{ room_id: "r101", occupancy: 2 }]);
  });
});

describe("telling reception why it was refused", () => {
  it("separates a room that went to somebody else from everything else", () => {
    expect(failureKind({ code: "23P01" })).toBe("taken");
    expect(failureKind({ message: 'conflicting key value violates exclusion constraint' })).toBe("taken");
    expect(failureKind({ code: "42501" })).toBe("unauthorised");
    expect(failureKind({ message: "no rate plan configured for this property" })).toBe("noRatePlan");
    expect(failureKind({ message: "network error" })).toBe("other");
    expect(failureKind(null)).toBe("other");
  });
});

describe("the list", () => {
  it("keeps the guest who called first at the top", () => {
    const list = [
      { id: "b", createdAt: 20 }, { id: "a", createdAt: 10 }, { id: "c", createdAt: 30 },
    ];
    expect(sortProvisionals(list).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(list[0].id).toBe("b"); // the caller's array is left alone
  });

  it("counts the ones that need attention apart from the ones still waiting", () => {
    const list = [
      { state: PENDING }, { state: FAILED }, { state: PENDING }, { state: SENT },
    ];
    expect(countByState(list)).toEqual({ pending: 2, failed: 1, sent: 1 });
    // One that landed is not something anybody has to do anything about.
    expect(needsAttention(list)).toBe(3);
  });
});
