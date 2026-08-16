import { describe, expect, it } from "vitest";
import {
  isHotelSlug, isStaffUsername, normalizeHotelSlug, normalizeStaffUsername,
  staffLoginEmail, staffProfileProblem,
} from "../lib/auth-login.js";

describe("staff login identity", () => {
  it("normalizes a short username without exposing an email to staff", () => {
    expect(normalizeStaffUsername("  Ahmed.1 ")).toBe("ahmed.1");
    expect(staffLoginEmail("greek-club-dahab", " Ahmed.1 ")).toBe("greek-club-dahab.ahmed.1@staff.easyroom.app");
  });

  it("accepts simple usernames and rejects spaces or very short values", () => {
    expect(isStaffUsername("reception1")).toBe(true);
    expect(isStaffUsername("hk-01")).toBe(true);
    expect(isStaffUsername("ab")).toBe(false);
    expect(isStaffUsername("ahmed ali")).toBe(false);
  });

  it("keys the same username to different hotels", () => {
    // "ahmed" at one hotel is not "ahmed" at another, which is the whole
    // reason the sign-in has to know the hotel before anybody is signed in.
    expect(staffLoginEmail("greek-club-dahab", "ahmed"))
      .not.toBe(staffLoginEmail("bedouin-lodge", "ahmed"));
  });

  it("tolerates a hotel code typed with stray case or spaces", () => {
    expect(staffLoginEmail("  Bedouin-Lodge ", "ahmed"))
      .toBe("bedouin-lodge.ahmed@staff.easyroom.app");
    expect(normalizeHotelSlug(" GREEK-club ")).toBe("greek-club");
  });

  it("rejects a hotel code that could not be one", () => {
    expect(isHotelSlug("greek-club-dahab")).toBe(true);
    expect(isHotelSlug("g")).toBe(false);
    expect(isHotelSlug("greek club")).toBe(false);
    expect(isHotelSlug("-greek")).toBe(false);
    expect(isHotelSlug("greek.club")).toBe(false);
    expect(isHotelSlug("")).toBe(false);
  });
});

/**
 * The card a manager edits when somebody's name is spelled wrong or their
 * number changed. The username is not in it on purpose — see the note on
 * staffProfileProblem.
 */
describe("editing a staff member's details", () => {
  it("accepts a name with no number, which is most of them", () => {
    expect(staffProfileProblem({ full_name: "أحمد صابر", phone: "" })).toBeNull();
    expect(staffProfileProblem({ full_name: "أحمد صابر" })).toBeNull();
  });

  it("insists on a name", () => {
    expect(staffProfileProblem({ full_name: "", phone: "01000000000" })).toBe("needStaffName");
    expect(staffProfileProblem({ full_name: "   " })).toBe("needStaffName");
    expect(staffProfileProblem({})).toBe("needStaffName");
    expect(staffProfileProblem()).toBe("needStaffName");
  });

  it("catches a number too short to dial", () => {
    expect(staffProfileProblem({ full_name: "أحمد", phone: "0100" })).toBe("phoneTooShort");
  });

  it("counts the digits, not the punctuation", () => {
    expect(staffProfileProblem({ full_name: "أحمد", phone: "+20 100 123 4567" })).toBeNull();
    expect(staffProfileProblem({ full_name: "أحمد", phone: "+20-10" })).toBe("phoneTooShort");
  });
});
