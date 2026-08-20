import { describe, expect, it } from "vitest";
import {
  accountChanges, accountForm, accountInsert, accountProblem, bookingCounts, sortAccounts,
} from "../lib/accounts";

const account = {
  id: "a1",
  name: "حكاية تريب",
  rate_plan_id: "plan-companies",
  contact_name: "عز الدين عبد العزيز",
  contact_phone: "01090700714",
  notes: "إقامة فطار",
  is_active: true,
};

describe("the form as it opens", () => {
  it("shows what the company already says", () => {
    expect(accountForm(account)).toEqual({
      name: "حكاية تريب",
      rate_plan_id: "plan-companies",
      contact_name: "عز الدين عبد العزيز",
      contact_phone: "01090700714",
      notes: "إقامة فطار",
    });
  });

  it("opens empty for a new company, with no rate plan chosen", () => {
    expect(accountForm(null)).toEqual({
      name: "", rate_plan_id: "", contact_name: "", contact_phone: "", notes: "",
    });
  });
});

describe("what the desk is stopped from saving", () => {
  it("insists on a name", () => {
    expect(accountProblem({ name: "  " }, [])).toBe("needCompanyName");
  });

  it("accepts a company with nothing but a name", () => {
    expect(accountProblem({ name: "حكاية تريب" }, [])).toBeNull();
  });

  /**
   * The unique index only catches an exact repeat. Two spellings of one
   * agency pass it and then sit in the picker as two companies with one
   * deal between them — the guests bug again, in another table.
   */
  it("refuses a second spelling of a company already on the list", () => {
    expect(accountProblem({ name: "حكايه تريب" }, [account])).toBe("nameTaken");
    expect(accountProblem({ name: " حكاية  تريب " }, [account])).toBe("nameTaken");
  });

  it("lets a company keep its own name while being edited", () => {
    // The list handed in is the *other* companies, so its own row is absent.
    expect(accountProblem({ name: "حكاية تريب" }, [])).toBeNull();
  });

  it("does not confuse two different companies", () => {
    expect(accountProblem({ name: "دهب تورز" }, [account])).toBeNull();
  });
});

describe("what gets written for a new company", () => {
  it("keeps the name and stores the blanks as nothing", () => {
    expect(accountInsert({ name: " دهب تورز ", rate_plan_id: "", contact_name: "", contact_phone: " ", notes: "" }, "prop"))
      .toEqual({
        property_id: "prop",
        name: "دهب تورز",
        rate_plan_id: null,
        contact_name: null,
        contact_phone: null,
        notes: null,
      });
  });
});

describe("what actually gets written on an edit", () => {
  const form = accountForm(account);

  it("writes nothing when nothing changed", () => {
    expect(accountChanges(form, account)).toBeNull();
  });

  it("does not count a change that is only whitespace", () => {
    expect(accountChanges({ ...form, name: " حكاية تريب " }, account)).toBeNull();
  });

  it("writes only the field that moved", () => {
    expect(accountChanges({ ...form, contact_phone: "01000000000" }, account))
      .toEqual({ contact_phone: "01000000000" });
  });

  it("clears a field to null rather than to an empty string", () => {
    expect(accountChanges({ ...form, notes: "" }, account)).toEqual({ notes: null });
  });

  /** Detaching the rate plan puts the company back on the standing prices. */
  it("detaches a rate plan as null", () => {
    expect(accountChanges({ ...form, rate_plan_id: "" }, account)).toEqual({ rate_plan_id: null });
  });
});

describe("how much each company is actually used", () => {
  it("counts the bookings filed against each one", () => {
    expect(bookingCounts([
      { account_id: "a1" }, { account_id: "a1" }, { account_id: "a2" }, { account_id: null }, {},
    ])).toEqual({ a1: 2, a2: 1 });
  });

  it("counts nothing out of nothing", () => {
    expect(bookingCounts(null)).toEqual({});
  });
});

describe("the order companies are shown in", () => {
  it("puts the live ones first, then sorts by name", () => {
    const rows = sortAccounts([
      { name: "دهب تورز", is_active: false },
      { name: "حكاية تريب", is_active: true },
      { name: "أوروبا ترافيل", is_active: true },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["أوروبا ترافيل", "حكاية تريب", "دهب تورز"]);
  });

  it("does not modify the list it was handed", () => {
    const rows = [{ name: "ب", is_active: true }, { name: "أ", is_active: true }];
    sortAccounts(rows);
    expect(rows.map((r) => r.name)).toEqual(["ب", "أ"]);
  });
});
