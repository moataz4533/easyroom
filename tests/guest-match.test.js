import { describe, expect, it } from "vitest";
import {
  duplicateCount, guestToReuse, namesOnPhone, normalisePhone, pickGuest,
  sameName, samePhone,
} from "../lib/guest-match";

describe("the same phone written differently", () => {
  it("treats the ways an Egyptian number is written as one number", () => {
    for (const written of ["01118070453", "+201118070453", "00201118070453", "01118070453 ", "011 1807 0453"]) {
      expect(normalisePhone(written)).toBe("01118070453");
    }
    expect(samePhone("+201118070453", "01118070453")).toBe(true);
  });

  it("does not match two different numbers, or nothing at all", () => {
    expect(samePhone("01118070453", "01118070454")).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(samePhone(null, "01118070453")).toBe(false);
    expect(normalisePhone(null)).toBe("");
  });
});

describe("choosing between rows on one number", () => {
  const bare = { id: "a", full_name: "معتز", created_at: "2026-08-01" };
  const recent = { id: "b", full_name: "معتز", created_at: "2026-08-10" };
  const detailed = { id: "c", full_name: "معتز", created_at: "2026-08-02", id_number: "123", nationality: "مصري" };

  it("prefers the one with a history, because the stays hang off it", () => {
    expect(pickGuest([bare, recent, detailed], { a: 5, b: 0, c: 1 }).id).toBe("a");
  });

  it("falls back to the one somebody actually filled in", () => {
    expect(pickGuest([bare, recent, detailed], {}).id).toBe("c");
  });

  it("then to the one seen most recently", () => {
    expect(pickGuest([bare, recent], {}).id).toBe("b");
  });

  it("copes with one row, or none", () => {
    expect(pickGuest([bare]).id).toBe("a");
    expect(pickGuest([])).toBeNull();
    expect(pickGuest(null)).toBeNull();
  });

  it("says how many extra rows there are, so the screen can mention it", () => {
    expect(duplicateCount([bare, recent, detailed])).toBe(2);
    expect(duplicateCount([bare])).toBe(0);
    expect(duplicateCount([])).toBe(0);
  });
});

describe("not making a thirteenth row for the same person", () => {
  const existing = [
    { id: "a", full_name: "معتز", phone: "01118070453", created_at: "2026-08-01" },
    { id: "b", full_name: "بولس", phone: "+201118070453", created_at: "2026-08-05" },
    { id: "c", full_name: "منى", phone: "01000000000", created_at: "2026-08-06" },
  ];

  it("reuses the guest with that number and that name", () => {
    expect(guestToReuse(existing, { name: "بولس", phone: "01118070453" }).id).toBe("b");
  });

  /**
   * The rule that changed, and why. Reception at this hotel types the
   * company's number and tells guests apart by name, so one number belongs
   * to dozens of people. Reusing any row on the number filed four September
   * bookings under a guest none of them were, and silently discarded the
   * name that had been typed.
   */
  it("makes a new guest when the name on the number is somebody else", () => {
    expect(guestToReuse(existing, { name: "أحمد", phone: "01118070453" })).toBeNull();
  });

  it("still reuses the same person spelled slightly differently", () => {
    expect(guestToReuse(existing, { name: " بولس ", phone: "01118070453" }).id).toBe("b");
  });

  it("makes a new guest when the number is new, or when there is no number", () => {
    expect(guestToReuse(existing, { name: "أحمد", phone: "01234567890" })).toBeNull();
    expect(guestToReuse(existing, { name: "أحمد", phone: "" })).toBeNull();
    expect(guestToReuse([], { name: "أحمد", phone: "01118070453" })).toBeNull();
  });
});

describe("two spellings of one name", () => {
  it("folds the Arabic that is orthography rather than identity", () => {
    expect(sameName("أحمد", "احمد")).toBe(true);
    expect(sameName("دعاء محمد", "دعاءمحمد")).toBe(true);
    expect(sameName("منى", "مني")).toBe(true);
    expect(sameName("فاطمة", "فاطمه")).toBe(true);
  });

  it("keeps different people apart", () => {
    expect(sameName("أحمد", "محمود")).toBe(false);
    expect(sameName("أحمد محمد", "أحمد")).toBe(false);
  });

  it("treats a missing name as nobody, never as everybody", () => {
    expect(sameName("", "")).toBe(false);
    expect(sameName(null, undefined)).toBe(false);
    expect(sameName("  ", "أحمد")).toBe(false);
  });
});

describe("who is already on a number", () => {
  const rows = [
    { id: "a", full_name: "دعاءمحمد", phone: "01220732569" },
    { id: "b", full_name: "دعاء محمد", phone: "01220732569" },
    { id: "c", full_name: "عمار الغواص", phone: "01220732569" },
    { id: "d", full_name: "زياد", phone: "01000000000" },
  ];

  it("lists the distinct names, so the screen can say who else is on it", () => {
    expect(namesOnPhone(rows, "01220732569")).toEqual(["دعاءمحمد", "عمار الغواص"]);
  });

  it("says nobody for a number with no history", () => {
    expect(namesOnPhone(rows, "01999999999")).toEqual([]);
    expect(namesOnPhone([], "01220732569")).toEqual([]);
  });
});

/**
 * Which prefix means "this country" was Egypt's, written into the code. A
 * Saudi hotel would have filed `+9665…` and `05…` as two different people —
 * the same fault that put twelve rows on one number here, arriving by a
 * different door.
 */
describe("a number written the way another country writes it", () => {
  it("still reads Egyptian numbers exactly as before", () => {
    expect(normalisePhone("+201118070453", "20")).toBe("01118070453");
    expect(normalisePhone("00201118070453", "20")).toBe("01118070453");
    expect(normalisePhone("01118070453", "20")).toBe("01118070453");
  });

  it("matches the two ways a Saudi number is written", () => {
    expect(normalisePhone("+966512345678", "966")).toBe("0512345678");
    expect(normalisePhone("0512345678", "966")).toBe("0512345678");
    expect(samePhone("+966512345678", "0512345678")).toBe(false); // hotel is Egyptian
  });

  it("leaves a number alone when it is not this country's", () => {
    // A German guest's number at an Egyptian hotel: nothing to strip, and
    // it still equals itself.
    expect(normalisePhone("+4915112345678", "20")).toBe("+4915112345678");
    expect(normalisePhone("+4915112345678", "20")).toBe(normalisePhone("+4915112345678", "20"));
  });
});
