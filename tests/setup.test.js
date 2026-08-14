import { describe, expect, it } from "vitest";
import {
  ADVISORY, BLOCKING, countByLevel, isDefaultType, isReadyToOperate, outstandingSetup,
} from "../lib/setup";

const ready = {
  rateCount: 12,
  types: [{ name: "غرفة بحرية" }, { name: "شاليه" }],
  hasPin: true,
  staffCount: 3,
  settings: { whatsapp_number: "+201001234567", cancellation_policy: "مجاني قبل ٤٨ ساعة." },
};

const ids = (state) => outstandingSetup(state).map((item) => item.id);

describe("what still blocks real use", () => {
  it("says nothing when the hotel is set up", () => {
    expect(outstandingSetup(ready)).toEqual([]);
    expect(isReadyToOperate(ready)).toBe(true);
  });

  it("flags missing rates first — every booking would price at zero", () => {
    expect(outstandingSetup({ ...ready, rateCount: 0 })[0]).toMatchObject({
      id: "rates", level: BLOCKING, tab: "rates",
    });
  });

  it("flags rooms still on the seeded default type", () => {
    expect(ids({ ...ready, types: [{ name: "غرفة قياسية" }] })).toContain("roomTypes");
    // One real type among them means somebody has started; that is not a block.
    expect(ids({ ...ready, types: [{ name: "غرفة قياسية" }, { name: "شاليه" }] })).not.toContain("roomTypes");
  });

  it("flags a missing manager password, because every money guard is then off", () => {
    const item = outstandingSetup({ ...ready, hasPin: false }).find((i) => i.id === "managerPassword");
    expect(item).toMatchObject({ level: BLOCKING, tab: "security" });
  });

  it("treats an empty hotel with no types at all as not yet started, not as default", () => {
    expect(ids({ ...ready, types: [] })).not.toContain("roomTypes");
  });
});

describe("what is merely incomplete", () => {
  it("mentions the WhatsApp number and policy the confirmation message needs", () => {
    const bare = { ...ready, settings: {} };
    expect(ids(bare)).toEqual(expect.arrayContaining(["whatsapp", "policy"]));
    expect(outstandingSetup(bare).every((i) => i.level === ADVISORY)).toBe(true);
    expect(isReadyToOperate(bare)).toBe(true);
  });

  it("treats blank space as unset", () => {
    expect(ids({ ...ready, settings: { whatsapp_number: "   ", cancellation_policy: "" } }))
      .toEqual(expect.arrayContaining(["whatsapp", "policy"]));
  });

  it("mentions staff while the owner is the only account", () => {
    expect(ids({ ...ready, staffCount: 1 })).toContain("staff");
    expect(ids({ ...ready, staffCount: 2 })).not.toContain("staff");
  });

  it("counts the two kinds separately", () => {
    const items = outstandingSetup({ rateCount: 0, types: [], hasPin: false, staffCount: 1, settings: {} });
    expect(countByLevel(items)).toEqual({ blocking: 2, advisory: 3 });
  });
});

describe("recognising the seeded room type", () => {
  it("matches the seeded name in either language and ignores spacing", () => {
    expect(isDefaultType({ name: "غرفة قياسية" })).toBe(true);
    expect(isDefaultType({ name: "  Standard Room  " })).toBe(true);
    expect(isDefaultType({ name: "شاليه" })).toBe(false);
    expect(isDefaultType({})).toBe(false);
  });
});
