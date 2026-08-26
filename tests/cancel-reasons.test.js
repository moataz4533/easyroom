import { describe, expect, it } from "vitest";
import { CANCEL_REASONS, cancelProblem, cancelReason, isNamedReason } from "../lib/cancel-reasons";

describe("the reasons offered", () => {
  it("keeps `other` last, because it is the way out and not a choice", () => {
    expect(CANCEL_REASONS[CANCEL_REASONS.length - 1]).toBe("other");
  });

  /**
   * The reason this list exists at all: a stay being lengthened, entered as
   * a new booking because the dates could not be changed on the old one.
   * If this keeps being picked, the fix is a screen, not a list.
   */
  it("names the case where the app is at fault, not the guest", () => {
    expect(CANCEL_REASONS).toContain("date_change");
  });
});

describe("what the desk is stopped from saving", () => {
  it("insists on a reason being chosen", () => {
    expect(cancelProblem("", "")).toBe("needCancelReason");
    expect(cancelProblem(null, "anything")).toBe("needCancelReason");
  });

  it("insists on words when the reason is `other`", () => {
    expect(cancelProblem("other", "   ")).toBe("needCancelWords");
    expect(cancelProblem("other", "النزيل اتصل وقال إنه هيأجل")).toBeNull();
  });

  it("asks for nothing more once a named reason is picked", () => {
    for (const key of ["guest_cancelled", "date_change", "duplicate", "mistake"]) {
      expect(cancelProblem(key, ""), key).toBeNull();
    }
  });
});

describe("what gets stored", () => {
  it("stores the key for a named reason, so counting is counting values", () => {
    expect(cancelReason("duplicate", "")).toBe("duplicate");
    // The words typed beside a named reason are not the reason.
    expect(cancelReason("mistake", "ignored")).toBe("mistake");
  });

  it("stores the words themselves for `other`", () => {
    expect(cancelReason("other", "  النزيل اتصل  ")).toBe("النزيل اتصل");
  });
});

describe("reading back what is already stored", () => {
  it("knows a named reason", () => {
    expect(isNamedReason("date_change")).toBe(true);
  });

  /**
   * Twenty-one live cancellations say `greekclub`. They have to keep
   * reading as what somebody typed, not as a missing translation key.
   */
  it("treats anything else as words somebody typed", () => {
    expect(isNamedReason("greekclub")).toBe(false);
    expect(isNamedReason("")).toBe(false);
    expect(isNamedReason(null)).toBe(false);
    // `other` is never stored as a value — the words are.
    expect(isNamedReason("other")).toBe(false);
  });
});
