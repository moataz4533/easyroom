import { describe, expect, it } from "vitest";
import {
  DISCOUNT_KINDS, discountForm, discountProblem, discountTotal,
  discountedRate, discountedStay, hasDiscount, previewStay,
} from "../lib/discount";

describe("what one night costs after a discount", () => {
  it("takes a share off", () => {
    expect(discountedRate(500, "percent", 10)).toBe(450);
    expect(discountedRate(450, "percent", 33)).toBe(301.5);
  });

  it("takes a fixed sum off", () => {
    expect(discountedRate(500, "amount", 50)).toBe(450);
  });

  it("names the price outright", () => {
    expect(discountedRate(500, "rate", 400)).toBe(400);
    // A "discount" above the list price is a special price, not an error.
    expect(discountedRate(500, "rate", 600)).toBe(600);
  });

  it("never goes below free", () => {
    expect(discountedRate(300, "amount", 500)).toBe(0);
    expect(discountedRate(300, "percent", 100)).toBe(0);
  });

  it("leaves the price alone when there is no discount", () => {
    expect(discountedRate(500, null, null)).toBe(500);
    expect(discountedRate(500, "", 10)).toBe(500);
    expect(discountedRate(500, "percent", "")).toBe(500);
    expect(discountedRate(500, "percent", "abc")).toBe(500);
  });

  it("rounds to the piastre, not beyond it", () => {
    expect(discountedRate(333.33, "percent", 15)).toBe(283.33);
  });
});

describe("a whole stay", () => {
  // The case the feature exists for: a stay crossing a season boundary.
  const season = [700, 700, 400, 400];

  it("discounts each night at its own price", () => {
    expect(discountedStay(season, "percent", 10)).toEqual({
      nights: 4, list: 2200, net: 1980, discount: 220,
    });
  });

  it("caps a fixed sum at each night, not at the stay", () => {
    expect(discountedStay([500, 100], "amount", 200)).toEqual({
      nights: 2, list: 600, net: 300, discount: 300,
    });
  });

  it("flattens the stay when a rate is named", () => {
    expect(discountedStay(season, "rate", 500)).toEqual({
      nights: 4, list: 2200, net: 2000, discount: 200,
    });
  });

  it("is a no-op with no discount", () => {
    expect(discountedStay(season, null, null)).toEqual({
      nights: 4, list: 2200, net: 2200, discount: 0,
    });
  });

  it("survives an empty stay", () => {
    expect(discountedStay([], "percent", 10)).toEqual({
      nights: 0, list: 0, net: 0, discount: 0,
    });
    expect(discountedStay(null, "percent", 10).net).toBe(0);
  });
});

describe("the quote shown before the booking exists", () => {
  it("matches the real answer for a percentage", () => {
    expect(previewStay(2200, 4, "percent", 10).net).toBe(1980);
  });

  it("matches the real answer for a named rate", () => {
    expect(previewStay(2200, 4, "rate", 500).net).toBe(2000);
  });

  it("says nothing when there are no nights", () => {
    expect(previewStay(2200, 0, "percent", 10)).toEqual({
      nights: 0, list: 0, net: 0, discount: 0,
    });
  });
});

describe("what the desk is stopped from entering", () => {
  it("accepts nothing at all", () => {
    expect(discountProblem("", "")).toBeNull();
    expect(discountProblem(null, null)).toBeNull();
  });

  it("wants a value once a kind is chosen", () => {
    expect(discountProblem("percent", "")).toBe("needValue");
    expect(discountProblem("amount", null)).toBe("needValue");
    expect(discountProblem("rate", "abc")).toBe("needValue");
  });

  it("refuses a negative and an impossible percentage", () => {
    expect(discountProblem("amount", -5)).toBe("negative");
    expect(discountProblem("percent", 120)).toBe("overHundred");
  });

  it("refuses a discount that discounts nothing", () => {
    expect(discountProblem("percent", 0)).toBe("noDiscount");
    expect(discountProblem("amount", 0)).toBe("noDiscount");
    // Zero is a real price: a room given away is a decision, not a mistake.
    expect(discountProblem("rate", 0)).toBeNull();
  });

  it("refuses a kind it does not know", () => {
    expect(discountProblem("half", 1)).toBe("unknownKind");
    expect(DISCOUNT_KINDS).toEqual(["percent", "amount", "rate"]);
  });

  it("accepts every valid shape", () => {
    expect(discountProblem("percent", 100)).toBeNull();
    expect(discountProblem("amount", 50)).toBeNull();
    expect(discountProblem("rate", 400)).toBeNull();
  });
});

describe("reading a stored allocation", () => {
  const discounted = { discount_kind: "percent", discount_value: "10.00", discount_note: "صاحب" };

  it("knows whether there is one", () => {
    expect(hasDiscount(discounted)).toBe(true);
    expect(hasDiscount({ discount_kind: null })).toBe(false);
    expect(hasDiscount(null)).toBe(false);
  });

  it("fills the form without trailing zeroes", () => {
    expect(discountForm(discounted)).toEqual({ kind: "percent", value: "10", note: "صاحب" });
    expect(discountForm({})).toEqual({ kind: "", value: "", note: "" });
  });

  it("adds up what was given away, ignoring rooms taken off the booking", () => {
    expect(discountTotal([
      { discount_amount: 220 },
      { discount_amount: 100, release_reason: "ألغى غرفة" },
      { discount_amount: null },
    ])).toBe(220);
    expect(discountTotal([])).toBe(0);
  });
});
