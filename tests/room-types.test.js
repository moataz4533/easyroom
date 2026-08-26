import { describe, expect, it } from "vitest";
import { typeCode, typeForm, typeInsert, typeProblem } from "../lib/room-types";

describe("the form as it opens", () => {
  it("asks for a name, an English name and how many it sleeps — and nothing else", () => {
    expect(typeForm(null)).toEqual({ name: "", name_en: "", max_occupancy: 2 });
  });

  it("shows what an existing type already says", () => {
    expect(typeForm({ name: "كينج", name_en: "King", max_occupancy: 3 }))
      .toEqual({ name: "كينج", name_en: "King", max_occupancy: 3 });
  });
});

describe("what the desk is stopped from saving", () => {
  const existing = [{ name: "دبل" }, { name: "كينج" }];

  it("insists on a name, and asks for nothing technical", () => {
    expect(typeProblem({ name: "  ", max_occupancy: 2 }, existing)).toBe("needTypeName");
    expect(typeProblem({ name: "تربل", max_occupancy: 3 }, existing)).toBeNull();
  });

  /** The rates matrix shows a tab per type; two tabs reading «دبل» is a
   *  coin toss over which one a booking is priced from. */
  it("refuses a second type with a name already on the list", () => {
    expect(typeProblem({ name: "دبل", max_occupancy: 2 }, existing)).toBe("typeNameTaken");
    expect(typeProblem({ name: " دبل ", max_occupancy: 2 }, existing)).toBe("typeNameTaken");
  });

  it("keeps the head count inside what a room can hold", () => {
    expect(typeProblem({ name: "سويت", max_occupancy: 0 }, [])).toBe("typeHeadsRange");
    expect(typeProblem({ name: "سويت", max_occupancy: 9 }, [])).toBe("typeHeadsRange");
    expect(typeProblem({ name: "سويت", max_occupancy: "" }, [])).toBe("typeHeadsRange");
    expect(typeProblem({ name: "سويت", max_occupancy: 6 }, [])).toBeNull();
  });
});

describe("the code nobody has to invent", () => {
  it("takes it from the English name when there is one", () => {
    expect(typeCode({ name: "كينج", name_en: "King" }, [])).toBe("KING");
  });

  /** An Arabic-only name leaves no letters, and that is fine — the code is
   *  a label and the name is what people read. */
  it("falls back to a plain label for an Arabic-only name", () => {
    expect(typeCode({ name: "دبل", name_en: "" }, [])).toBe("TYPE");
  });

  it("counts up rather than colliding, because the database enforces it", () => {
    expect(typeCode({ name: "دبل" }, ["TYPE"])).toBe("TYPE2");
    expect(typeCode({ name: "دبل" }, ["TYPE", "TYPE2"])).toBe("TYPE3");
    expect(typeCode({ name: "King", name_en: "King" }, ["king"])).toBe("KING2");
  });
});

describe("what gets written", () => {
  it("derives the code and keeps base occupancy inside max", () => {
    expect(typeInsert({ name: " كينج ", name_en: "King", max_occupancy: 3 }, "prop", ["STD"], 2))
      .toEqual({
        property_id: "prop", code: "KING", name: "كينج", name_en: "King",
        max_occupancy: 3, base_occupancy: 2, sort_order: 2,
      });
  });

  /** The database checks base <= max, so a single cannot be seeded with 2. */
  it("does not seed a single room with a base of two", () => {
    expect(typeInsert({ name: "فردية", max_occupancy: 1 }, "prop", [], 3))
      .toMatchObject({ max_occupancy: 1, base_occupancy: 1, name_en: null });
  });
});
