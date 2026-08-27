import { describe, expect, it } from "vitest";
import {
  extraPayloads, extraRow, extrasProblem, extrasTotal, fillFromItem,
} from "../lib/booking-extras";

const breakfast = { id: "ci-1", name: "فطار", default_amount: 150 };

describe("a line as it opens", () => {
  it("starts blank, with one of whatever it is", () => {
    expect(extraRow()).toMatchObject({
      charge_item_id: "", description: "", quantity: "1", unit_amount: "",
    });
  });

  it("gives every line its own key, so two blank lines are two lines", () => {
    expect(extraRow().key).not.toBe(extraRow().key);
  });

  it("fills itself from the catalogue when one is picked", () => {
    expect(extraRow(breakfast)).toMatchObject({
      charge_item_id: "ci-1", description: "فطار", unit_amount: "150",
    });
  });
});

describe("picking a catalogue item on an existing line", () => {
  it("brings the name and the standing price with it", () => {
    const row = fillFromItem(extraRow(), breakfast);
    expect(row).toMatchObject({ charge_item_id: "ci-1", description: "فطار", unit_amount: "150" });
  });

  /** The price is filled in, not locked: giving one away is a decision. */
  it("leaves the price editable afterwards", () => {
    const row = { ...fillFromItem(extraRow(), breakfast), unit_amount: "0" };
    expect(extrasProblem([row])).toBeNull();
    expect(extrasTotal([row])).toBe(0);
  });

  it("clears the line when the pick is undone", () => {
    const row = fillFromItem(fillFromItem(extraRow(), breakfast), null);
    expect(row).toMatchObject({ charge_item_id: "", description: "", unit_amount: "" });
  });
});

describe("what the desk is stopped from saving", () => {
  it("accepts nothing at all — extras are optional", () => {
    expect(extrasProblem([])).toBeNull();
    expect(extrasProblem(null)).toBeNull();
  });

  it("insists on a description", () => {
    expect(extrasProblem([{ description: "  ", quantity: "1", unit_amount: "150" }]))
      .toBe("needDescription");
  });

  /** A forgotten price is not a free breakfast; it is a forgotten price. */
  it("refuses a blank price, and accepts a deliberate zero", () => {
    expect(extrasProblem([{ description: "ترانسفير", quantity: "1", unit_amount: "" }]))
      .toBe("needAmount");
    expect(extrasProblem([{ description: "ترانسفير", quantity: "1", unit_amount: "0" }]))
      .toBeNull();
  });

  it("refuses a quantity of nothing", () => {
    expect(extrasProblem([{ description: "ترانسفير", quantity: "0", unit_amount: "300" }]))
      .toBe("needQuantity");
  });

  it("reports the first bad line, not the last", () => {
    expect(extrasProblem([
      { description: "", quantity: "1", unit_amount: "1" },
      { description: "x", quantity: "0", unit_amount: "1" },
    ])).toBe("needDescription");
  });
});

describe("what the lines add to the quote", () => {
  it("multiplies each line and adds them up", () => {
    expect(extrasTotal([
      { quantity: "2", unit_amount: "150" },
      { quantity: "1", unit_amount: "300" },
    ])).toBe(600);
  });

  it("ignores a line still being typed rather than counting it as zero", () => {
    expect(extrasTotal([{ quantity: "2", unit_amount: "150" }, { quantity: "", unit_amount: "" }]))
      .toBe(300);
  });
});

describe("what gets sent", () => {
  it("sends one call per line, in the order they were typed", () => {
    const rows = [
      { charge_item_id: "ci-1", description: " فطار ", quantity: "2", unit_amount: "150" },
      { charge_item_id: "", description: "ترانسفير المطار", quantity: "1", unit_amount: "300" },
    ];
    expect(extraPayloads(rows, "bk-1")).toEqual([
      { p_booking: "bk-1", p_item: "ci-1", p_description: "فطار", p_quantity: 2, p_amount: 150 },
      { p_booking: "bk-1", p_item: null, p_description: "ترانسفير المطار", p_quantity: 1, p_amount: 300 },
    ]);
  });
});
