import { describe, expect, it } from "vitest";
import { copiedRates, copyCount, key } from "../lib/rate-copy";

const plans = [{ id: "direct" }, { id: "company" }];
const rates = {
  [key("double", "direct", 1)]: 1200,
  [key("double", "direct", 2)]: 1400,
  [key("double", "company", 1)]: 1000,
  [key("double", "company", 2)]: 1200,
  // Three people do not fit in this room, so the box is empty.
  [key("double", "direct", 3)]: "",
};

describe("pricing one type from another", () => {
  it("copies every priced box across, plan by plan", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 3 });
    expect(filled).toEqual({
      [key("king", "direct", 1)]: 1200,
      [key("king", "direct", 2)]: 1400,
      [key("king", "company", 1)]: 1000,
      [key("king", "company", 2)]: 1200,
    });
  });

  /**
   * An empty box in the source means "this many people do not fit". Copying
   * a blank over a filled box would quietly unprice a room, and a room with
   * no price quotes zero.
   */
  it("leaves the empty boxes empty rather than copying a blank", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 3 });
    expect(filled).not.toHaveProperty(key("king", "direct", 3));
  });

  it("adds a flat amount — «زي الدبل زائد ٢٠٠»", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 2, addAmount: 200 });
    expect(filled[key("king", "direct", 2)]).toBe(1600);
    expect(filled[key("king", "company", 1)]).toBe(1200);
  });

  it("adds a percentage — «زي الدبل زائد ١٠٪»", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 2, addPercent: 10 });
    expect(filled[key("king", "direct", 2)]).toBe(1540);
  });

  it("takes money off as readily as it puts it on", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 1, addPercent: -25 });
    expect(filled[key("king", "direct", 1)]).toBe(900);
  });

  it("quotes whole pounds, never piastres", () => {
    const odd = { [key("a", "direct", 1)]: 1333 };
    const filled = copiedRates(odd, { from: "a", to: "b", plans: [{ id: "direct" }], maxOccupancy: 1, addPercent: 7 });
    expect(filled[key("b", "direct", 1)]).toBe(1426);
  });

  it("never produces a negative price", () => {
    const filled = copiedRates(rates, { from: "double", to: "king", plans, maxOccupancy: 1, addAmount: -99999 });
    expect(filled[key("king", "direct", 1)]).toBe(0);
  });

  it("refuses to copy a type onto itself, or from nothing", () => {
    expect(copiedRates(rates, { from: "double", to: "double", plans, maxOccupancy: 2 })).toEqual({});
    expect(copiedRates(rates, { from: "", to: "king", plans, maxOccupancy: 2 })).toEqual({});
  });
});

describe("saying how much will be filled before it happens", () => {
  it("counts the boxes", () => {
    expect(copyCount(rates, { from: "double", to: "king", plans, maxOccupancy: 3 })).toBe(4);
    expect(copyCount(rates, { from: "double", to: "double", plans, maxOccupancy: 3 })).toBe(0);
  });
});
