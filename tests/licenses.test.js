import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, daysBetween, extendProblem, licenseNotice, licenseState,
  licenseTone, licenseTotals, lockReason, openingCalls, openingProblem,
  renewalBase, renewalEnd, setLicenseProblem,
} from "../lib/licenses";

describe("licence dates", () => {
  it("adds months the way Postgres does", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-10-10", 12)).toBe("2027-10-10");
    expect(addMonths("nope", 1)).toBeNull();
  });

  it("adds days and counts between them", () => {
    expect(addDays("2026-10-10", 14)).toBe("2026-10-24");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
    expect(daysBetween("2026-10-10", "2026-10-24")).toBe(14);
    expect(daysBetween("2026-10-10", "2026-10-07")).toBe(-3);
  });
});

describe("licenseState mirrors the database", () => {
  const today = "2026-10-10";
  it("reads each state", () => {
    expect(licenseState(null, 7, today)).toBe("unlimited");
    expect(licenseState("2027-01-01", 7, today)).toBe("active");
    expect(licenseState("2026-10-24", 7, today)).toBe("expiring");
    expect(licenseState("2026-10-25", 7, today)).toBe("active");
    expect(licenseState("2026-10-10", 7, today)).toBe("expiring");
    expect(licenseState("2026-10-07", 7, today)).toBe("grace");
    expect(licenseState("2026-10-03", 7, today)).toBe("grace");
    expect(licenseState("2026-10-02", 7, today)).toBe("expired");
    expect(licenseState("2026-10-09", 0, today)).toBe("expired");
  });

  it("gives every state a tone", () => {
    expect(licenseTone("expired")).toBe("bad");
    expect(licenseTone("grace")).toBe("bad");
    expect(licenseTone("expiring")).toBe("warn");
    expect(licenseTone("active")).toBe("ok");
    expect(licenseTone("unlimited")).toBe("ok");
  });
});

describe("renewal", () => {
  const today = "2026-10-10";
  it("continues from the end while running, so paying early loses nothing", () => {
    const license = { ends_on: "2026-11-01", grace_days: 7, today };
    expect(renewalBase(license)).toBe("2026-11-01");
    expect(renewalEnd(license, 3)).toBe("2027-02-01");
  });

  it("continues from the end in grace, which is a courtesy and not free days", () => {
    expect(renewalBase({ ends_on: "2026-10-07", grace_days: 7, today })).toBe("2026-10-07");
  });

  it("starts today once locked, or when it was open-ended", () => {
    expect(renewalBase({ ends_on: "2026-09-30", grace_days: 7, today })).toBe(today);
    expect(renewalBase({ ends_on: null, grace_days: 7, today })).toBe(today);
  });

  it("refuses impossible renewals", () => {
    expect(extendProblem({ months: 0 })).toBe("months");
    expect(extendProblem({ months: 61 })).toBe("months");
    expect(extendProblem({ months: 1.5 })).toBe("months");
    expect(extendProblem({ months: 3, amount: "-5" })).toBe("negativeAmount");
    expect(extendProblem({ months: 3, amount: "abc" })).toBe("amount");
    expect(extendProblem({ months: 3, amount: "" })).toBeNull();
    expect(extendProblem({ months: 12, amount: "6000" })).toBeNull();
  });

  it("refuses a dated licence without a date, and an open one is fine without", () => {
    expect(setLicenseProblem({ kind: "paid", endsOn: "" })).toBe("endsOn");
    expect(setLicenseProblem({ kind: "trial", endsOn: "2026-02-30" })).toBe("endsOn");
    expect(setLicenseProblem({ kind: "unlimited", endsOn: "" })).toBeNull();
    expect(setLicenseProblem({ kind: "gift", endsOn: "2027-01-01" })).toBe("kind");
    expect(setLicenseProblem({ kind: "paid", endsOn: "2027-01-01", grace: "61" })).toBe("grace");
    expect(setLicenseProblem({ kind: "paid", endsOn: "2027-01-01", grace: "0" })).toBeNull();
  });
});

describe("what the platform and the hotel are told", () => {
  it("adds up the panel's licence line", () => {
    const totals = licenseTotals([
      { state: "expiring", kind: "trial", paid_this_year: 0, paid_total: 0 },
      { state: "grace", kind: "paid", paid_this_year: "1500", paid_total: "3000" },
      { state: "expired", kind: "paid", paid_this_year: null, paid_total: "500" },
      { state: "unlimited", kind: "unlimited" },
    ]);
    expect(totals).toEqual({
      expiring: 1, grace: 1, expired: 1, trials: 1, paidThisYear: 1500, paidTotal: 3500,
    });
  });

  it("warns only whoever can pay, until grace, then everybody", () => {
    expect(licenseNotice({ state: "expiring" }, "owner")).toBe("expiring");
    expect(licenseNotice({ state: "expiring" }, "manager")).toBe("expiring");
    expect(licenseNotice({ state: "expiring" }, "reception")).toBeNull();
    expect(licenseNotice({ state: "grace" }, "reception")).toBe("grace");
    expect(licenseNotice({ state: "active" }, "owner")).toBeNull();
    expect(licenseNotice(null, "owner")).toBeNull();
  });

  it("tells a locked-out account why", () => {
    expect(lockReason([{ hotel_active: true, state: "expired" }])).toBe("expired");
    expect(lockReason([{ hotel_active: false, state: "active" }])).toBe("suspended");
    expect(lockReason([{ hotel_active: true, state: "active" }])).toBeNull();
    expect(lockReason([])).toBeNull();
  });
});

describe("opening a hotel on a licence", () => {
  const today = "2026-10-10";
  it("opens a trial for the days chosen", () => {
    expect(openingCalls({ mode: "trial", trialDays: 30 }, today)).toEqual([
      { fn: "platform_set_license", args: { p_kind: "trial", p_ends_on: "2026-11-09", p_note: null } },
    ]);
  });

  it("opens paid months from today, with the payment written down", () => {
    const calls = openingCalls({ mode: "paid", months: 6, amount: "3000", method: "cash" }, today);
    expect(calls.map((call) => call.fn)).toEqual(["platform_set_license", "platform_extend_license"]);
    expect(calls[0].args.p_ends_on).toBe(today);
    expect(calls[1].args).toMatchObject({ p_months: 6, p_amount: 3000, p_currency: "EGP", p_method: "cash" });
    expect(openingCalls({ mode: "paid", months: 1, amount: "" }, today)[1].args.p_amount).toBeNull();
  });

  it("opens open-ended with no date", () => {
    expect(openingCalls({ mode: "unlimited" }, today)[0].args).toEqual({ p_kind: "unlimited", p_note: null });
  });

  it("checks the choice before anything is created", () => {
    expect(openingProblem({ mode: "trial", trialDays: "14" })).toBeNull();
    expect(openingProblem({ mode: "trial", trialDays: "0" })).toBe("trialDays");
    expect(openingProblem({ mode: "paid", months: "0" })).toBe("months");
    expect(openingProblem({ mode: "paid", months: "12", amount: "-1" })).toBe("negativeAmount");
    expect(openingProblem({ mode: "unlimited" })).toBeNull();
    expect(openingProblem({ mode: "?" })).toBe("kind");
  });
});
