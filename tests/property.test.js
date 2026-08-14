import { describe, expect, it } from "vitest";
import {
  foreignCacheKeys, needsSwitcher, pickProperty, roleIn, sortProperties,
} from "../lib/property";

const greek = { id: "p1", name: "النادي اليوناني" };
const bedouin = { id: "p2", name: "بدوي لودج" };
const sea = { id: "p3", name: "الشاطئ" };

describe("choosing which hotel is open", () => {
  it("opens the one they were last in", () => {
    expect(pickProperty([greek, bedouin], "p2")).toBe(bedouin);
  });

  it("does not put somebody back inside a hotel they were removed from", () => {
    // The saved id is no longer among their memberships, so it is ignored
    // rather than trusted.
    expect(pickProperty([greek], "p2")).toBe(greek);
  });

  it("needs no saved choice when there is only one", () => {
    expect(pickProperty([greek], null)).toBe(greek);
  });

  it("says nothing rather than guessing when they belong to none", () => {
    expect(pickProperty([], "p1")).toBeNull();
    expect(pickProperty(null, null)).toBeNull();
  });

  it("is stable when there is no saved choice, so the app opens the same way twice", () => {
    expect(pickProperty([sea, greek, bedouin], null))
      .toBe(pickProperty([bedouin, sea, greek], null));
  });
});

describe("showing the switcher at all", () => {
  it("stays hidden for a hotel that is the only one", () => {
    expect(needsSwitcher([greek])).toBe(false);
    expect(needsSwitcher([])).toBe(false);
    expect(needsSwitcher(null)).toBe(false);
    expect(needsSwitcher([greek, bedouin])).toBe(true);
  });
});

describe("the role belongs to the hotel, not to the person", () => {
  const memberships = [
    { property_id: "p1", role: "owner", is_active: true },
    { property_id: "p2", role: "reception", is_active: true },
    { property_id: "p3", role: "manager", is_active: false },
  ];

  it("gives each hotel its own role", () => {
    expect(roleIn(memberships, "p1")).toBe("owner");
    expect(roleIn(memberships, "p2")).toBe("reception");
  });

  it("gives nothing for a membership that was switched off, or one that never existed", () => {
    expect(roleIn(memberships, "p3")).toBeNull();
    expect(roleIn(memberships, "p9")).toBeNull();
    expect(roleIn(memberships, null)).toBeNull();
  });
});

describe("what the device keeps for the other hotel", () => {
  const keys = [
    "easyroom:cache:board:p1",
    "easyroom:cache:board:p2",
    "easyroom:cache:tape:p2:2026-08-01:2026-08-08",
    "easyroom:queue",
    "easyroom-login-mode",
  ];

  it("names every saved copy that does not belong to the hotel now open", () => {
    expect(foreignCacheKeys(keys, "p1")).toEqual([
      "easyroom:cache:board:p2",
      "easyroom:cache:tape:p2:2026-08-01:2026-08-08",
    ]);
  });

  it("leaves the queue and the device's own settings alone", () => {
    expect(foreignCacheKeys(keys, "p2")).toEqual(["easyroom:cache:board:p1"]);
  });

  it("copes with nothing saved", () => {
    expect(foreignCacheKeys(null, "p1")).toEqual([]);
  });
});

describe("listing them", () => {
  it("orders by name so the list does not move between visits", () => {
    // Arabic collation, so "الشاطئ" and "النادي" come before "بدوي".
    expect(sortProperties([sea, greek, bedouin]).map((p) => p.name))
      .toEqual(["الشاطئ", "النادي اليوناني", "بدوي لودج"]);
    expect(sortProperties([greek, sea, bedouin]).map((p) => p.id))
      .toEqual(sortProperties([bedouin, greek, sea]).map((p) => p.id));
  });
});
