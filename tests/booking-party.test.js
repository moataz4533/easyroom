import { describe, expect, it } from "vitest";
import {
  PARTIES, flatByHeadCount, headCounts, isParty, openingParty, partyOf,
  planForParty, plansForParty,
} from "../lib/booking-party";

const plans = [
  { id: "d1", party: "direct", is_active: true, is_default: false },
  { id: "d2", party: "direct", is_active: true, is_default: true },
  { id: "c1", party: "company", is_active: true, is_default: false },
  { id: "c2", party: "company", is_active: false, is_default: false },
  { id: "x1", is_active: true, is_default: false },
];

describe("partyOf", () => {
  it("reads the party off the plan", () => {
    expect(partyOf({ party: "company" })).toBe("company");
    expect(partyOf({ party: "direct" })).toBe("direct");
  });

  it("treats an unlabelled or nonsense plan as an individual one", () => {
    expect(partyOf({})).toBe("direct");
    expect(partyOf({ party: "walk-in" })).toBe("direct");
    expect(partyOf(null)).toBe("direct");
  });

  it("knows the two parties and nothing else", () => {
    expect(PARTIES).toEqual(["direct", "company"]);
    expect(isParty("company")).toBe(true);
    expect(isParty("agency")).toBe(false);
  });
});

describe("plansForParty", () => {
  it("gives one party's live plans", () => {
    expect(plansForParty(plans, "direct").map((p) => p.id)).toEqual(["d1", "d2", "x1"]);
    expect(plansForParty(plans, "company").map((p) => p.id)).toEqual(["c1"]);
  });

  it("leaves a hidden plan out — a retired price is not a price", () => {
    expect(plansForParty(plans, "company").some((p) => p.id === "c2")).toBe(false);
  });
});

describe("openingParty", () => {
  it("opens where the hotel's default plan sells", () => {
    expect(openingParty(plans)).toBe("direct");
    const agency = [{ id: "c1", party: "company", is_active: true, is_default: true }];
    expect(openingParty(agency)).toBe("company");
  });

  it("keeps a choice the user already made", () => {
    expect(openingParty(plans, "company")).toBe("company");
  });

  it("refuses to open on a party with nothing to sell", () => {
    const onlyCompany = [{ id: "c1", party: "company", is_active: true }];
    expect(openingParty(onlyCompany, "direct")).toBe("company");
  });

  it("survives a hotel with no plans at all", () => {
    expect(openingParty([])).toBe("direct");
    expect(openingParty(null)).toBe("direct");
  });
});

describe("planForParty", () => {
  it("prefers the party's default plan", () => {
    expect(planForParty(plans, "direct")).toBe("d2");
  });

  it("keeps the plan already chosen when it belongs to the party", () => {
    expect(planForParty(plans, "direct", "d1")).toBe("d1");
  });

  it("drops a plan that belongs to the other party", () => {
    expect(planForParty(plans, "company", "d1")).toBe("c1");
  });

  it("returns nothing when the party has no plans", () => {
    expect(planForParty([{ id: "d1", party: "direct", is_active: true }], "company")).toBe("");
  });
});

describe("flatByHeadCount", () => {
  const counts = [1, 2, 3, 4];

  it("spots the price list that ignores the head count", () => {
    const rates = { "t|p|1": 1200, "t|p|2": 1200, "t|p|3": 1200, "t|p|4": 1200 };
    expect(flatByHeadCount(rates, "t", "p", counts)).toBe(true);
  });

  it("stays quiet when the head count does move the price", () => {
    const rates = { "t|p|1": 1000, "t|p|2": 1200, "t|p|3": 1400, "t|p|4": 1600 };
    expect(flatByHeadCount(rates, "t", "p", counts)).toBe(false);
  });

  it("ignores the boxes nobody has filled in", () => {
    const rates = { "t|p|1": 1200, "t|p|2": "", "t|p|3": null, "t|p|4": 1200 };
    expect(flatByHeadCount(rates, "t", "p", counts)).toBe(true);
  });

  it("says nothing about a plan with one price or none", () => {
    expect(flatByHeadCount({ "t|p|1": 1200 }, "t", "p", counts)).toBe(false);
    expect(flatByHeadCount({}, "t", "p", counts)).toBe(false);
  });
});

describe("headCounts", () => {
  it("stops at what the room actually holds", () => {
    expect(headCounts(4)).toEqual([1, 2, 3, 4]);
    expect(headCounts(1)).toEqual([1]);
  });

  it("never offers nobody, and never offers more than the database allows", () => {
    expect(headCounts(0)).toEqual([1]);
    expect(headCounts(null)).toEqual([1]);
    expect(headCounts(99)).toHaveLength(12);
  });
});
