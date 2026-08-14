import { describe, expect, it } from "vitest";
import {
  isReachableEmail, recoveryFrom, resetRedirectTo, validateNewPassword,
} from "../lib/password-reset";
import { staffLoginEmail } from "../lib/auth-login";

describe("who can be sent a reset at all", () => {
  it("accepts an ordinary address", () => {
    expect(isReachableEmail("moataz@example.com")).toBe(true);
    expect(isReachableEmail("  Owner@Hotel.co.uk ")).toBe(true);
  });

  it("refuses the internal address a staff username becomes", () => {
    // There is no mailbox behind it, so a reset sent there is a message the
    // staff member would wait for for ever.
    expect(isReachableEmail(staffLoginEmail("greek-club-dahab", "ahmed"))).toBe(false);
  });

  it("refuses anything that is not an address", () => {
    expect(isReachableEmail("ahmed")).toBe(false);
    expect(isReachableEmail("ahmed@")).toBe(false);
    expect(isReachableEmail("ahmed@hotel")).toBe(false);
    expect(isReachableEmail("")).toBe(false);
    expect(isReachableEmail(null)).toBe(false);
  });
});

describe("the new password", () => {
  it("accepts one long enough and typed twice the same", () => {
    expect(validateNewPassword("dahab-2026", "dahab-2026")).toEqual([]);
  });

  it("names each problem separately, so the screen can say both", () => {
    expect(validateNewPassword("short", "other")).toEqual(["tooShort", "mismatch"]);
    expect(validateNewPassword("longenough", "longenoug")).toEqual(["mismatch"]);
    expect(validateNewPassword("abc", "abc")).toEqual(["tooShort"]);
  });

  it("treats nothing typed as too short rather than as fine", () => {
    expect(validateNewPassword("", "")).toEqual(["tooShort"]);
    expect(validateNewPassword(null, null)).toEqual(["tooShort"]);
  });
});

describe("reading the link the message sent", () => {
  it("recognises the fragment form", () => {
    expect(recoveryFrom({ hash: "#access_token=abc&type=recovery&expires_in=3600" }))
      .toEqual({ kind: "token" });
  });

  it("recognises the code form", () => {
    expect(recoveryFrom({ search: "?code=xyz-123" })).toEqual({ kind: "code", code: "xyz-123" });
  });

  it("surfaces an expired link rather than showing an empty form", () => {
    expect(recoveryFrom({ hash: "#error=access_denied&error_description=Email+link+is+invalid+or+has+expired" }))
      .toMatchObject({ kind: "error" });
    expect(recoveryFrom({ search: "?error_description=expired" })).toMatchObject({ kind: "error" });
  });

  it("says so plainly when somebody just opened the page", () => {
    expect(recoveryFrom({})).toEqual({ kind: "none" });
    expect(recoveryFrom({ hash: "#access_token=abc" })).toEqual({ kind: "none" });
    // A signed-in session is not a recovery link.
    expect(recoveryFrom({ hash: "#type=signup&access_token=abc" })).toEqual({ kind: "none" });
  });
});

describe("where the message sends them back", () => {
  it("keeps the language they asked in", () => {
    expect(resetRedirectTo("https://easyroom-gray.vercel.app", "ar"))
      .toBe("https://easyroom-gray.vercel.app/ar/reset-password");
    expect(resetRedirectTo("https://easyroom-gray.vercel.app/", "en"))
      .toBe("https://easyroom-gray.vercel.app/en/reset-password");
  });
});
