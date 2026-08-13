import { describe, expect, it } from "vitest";
import { isStaffUsername, normalizeStaffUsername, staffLoginEmail } from "../lib/auth-login.js";

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
});
