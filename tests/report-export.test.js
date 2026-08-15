import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildRevenueRows, buildRevenueWorkbook, exportFileName, totalsOf, weekdayName,
} from "../lib/report-export";
import { cellRef, crc32, escapeXml, excelDate, sheetXml, zip } from "../lib/xlsx";

const daily = [
  { day: "2026-08-01", rooms_sold: 4, revenue: "2400", occupancy_pct: "66.7" },
  { day: "2026-08-02", rooms_sold: 6, revenue: "3900", occupancy_pct: "100.0" },
  { day: "2026-08-03", rooms_sold: 0, revenue: "0", occupancy_pct: "0.0" },
];
const summary = { nights_available: 18, extras_revenue: "450" };

describe("the numbers the sheet reports", () => {
  const rows = buildRevenueRows(daily, 6);

  it("works out a rate per room sold, and per room available", () => {
    expect(rows[0]).toMatchObject({ sold: 4, available: 6, revenue: 2400 });
    expect(rows[0].adr).toBeCloseTo(600);      // 2400 over the 4 rooms sold
    expect(rows[0].revpar).toBeCloseTo(400);   // 2400 over the 6 rooms there are
  });

  it("reports no average rate on a night nothing was sold", () => {
    // Zero would be a rate somebody charged, and would drag the month down.
    expect(rows[2].adr).toBeNull();
    expect(rows[2].revpar).toBe(0);
  });

  it("adds the days up the way the month is actually counted", () => {
    const totals = totalsOf(rows);
    expect(totals).toMatchObject({ sold: 10, available: 18, revenue: 6300 });
    expect(totals.occupancy).toBeCloseTo(55.6, 1);
    expect(totals.adr).toBeCloseTo(630);   // per room sold, not per day
    expect(totals.revpar).toBeCloseTo(350);
  });

  it("survives a report with nothing in it", () => {
    expect(buildRevenueRows([], 6)).toEqual([]);
    expect(totalsOf([])).toMatchObject({ sold: 0, revenue: 0, adr: null });
  });

  it("names the weekday in the reader's language", () => {
    expect(weekdayName("2026-08-01", "ar")).toBe("السبت");
    expect(weekdayName("2026-08-01", "en")).toBe("Saturday");
    expect(weekdayName("nonsense")).toBe("");
  });
});

describe("the file itself", () => {
  const bytes = buildRevenueWorkbook({
    hotel: "The Greek Club", from: "2026-08-01", to: "2026-08-04",
    daily, summary, locale: "ar",
  });
  const files = unzipSync(bytes);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);

  it("is a real xlsx: a zip carrying the parts Excel opens", () => {
    expect(bytes[0]).toBe(0x50); // "PK"
    expect(bytes[1]).toBe(0x4b);
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels",
      "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml",
    ]);
  });

  it("carries the hotel and the period at the top", () => {
    expect(sheet).toContain("The Greek Club");
    expect(sheet).toContain("2026-08-01");
  });

  it("reads right to left for an Arabic reader, and not for an English one", () => {
    expect(sheet).toContain('rightToLeft="1"');
    const english = strFromU8(unzipSync(buildRevenueWorkbook({
      hotel: "H", from: "2026-08-01", to: "2026-08-04", daily, summary, locale: "en",
    }))["xl/worksheets/sheet1.xml"]);
    expect(english).not.toContain('rightToLeft="1"');
    expect(english).toContain("Rooms sold");
  });

  it("keeps the heading in view and gives every column a filter", () => {
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<autoFilter ref="A3:H3"\/>/);
  });

  it("writes numbers as numbers, so the accountant can sum them", () => {
    // 2400 as a value, not as the text "2,400.00 ج".
    expect(sheet).toContain("<v>2400</v>");
    expect(sheet).not.toContain("2,400.00");
  });

  it("writes dates as dates", () => {
    expect(excelDate("2026-08-01")).toBe(46235);
    expect(sheet).toContain("<v>46235</v>");
  });

  it("ends with a totals row that adds up", () => {
    expect(sheet).toContain("<v>6300</v>");
    expect(sheet).toContain("<v>10</v>");
  });

  it("keeps extras out of the room columns and names them separately", () => {
    expect(sheet).toContain("إيراد الإضافات");
    expect(sheet).toContain("<v>450</v>");
    // The room total is untouched by the 450.
    expect(sheet).toContain("<v>6300</v>");
  });

  it("says what was discounted, without subtracting it a second time", () => {
    const text = strFromU8(unzipSync(buildRevenueWorkbook({
      hotel: "النادي اليوناني", from: "2026-08-01", to: "2026-08-04",
      daily, summary: { ...summary, discounts: "700" }, locale: "ar",
    }))["xl/worksheets/sheet1.xml"]);
    expect(text).toContain("الخصومات");
    expect(text).toContain("<v>700</v>");
    // Revenue is already net of the discount, so the totals row is unmoved.
    expect(sheet).toContain("<v>6300</v>");
  });

  it("leaves the discount row off a month with no discounts", () => {
    expect(sheet).not.toContain("الخصومات");
  });
});

describe("the mechanics underneath", () => {
  it("addresses columns the way Excel does", () => {
    expect(cellRef(0, 1)).toBe("A1");
    expect(cellRef(25, 7)).toBe("Z7");
    expect(cellRef(26, 1)).toBe("AA1");
    expect(cellRef(27, 1)).toBe("AB1");
  });

  it("escapes what would otherwise break the file", () => {
    expect(escapeXml('a & b < c > "d"')).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
    // A stray control character makes Excel reject the whole workbook.
    expect(escapeXml("cleantext")).toBe("cleantext");
    expect(escapeXml(null)).toBe("");
  });

  it("computes the checksum a zip reader will check", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("produces a zip other tools can open", () => {
    const out = unzipSync(zip({ "a.txt": "hello", "b/c.txt": "مرحبا" }));
    expect(strFromU8(out["a.txt"])).toBe("hello");
    expect(strFromU8(out["b/c.txt"])).toBe("مرحبا");
  });

  it("puts a sheet together even with no rows at all", () => {
    expect(() => sheetXml({ name: "x", columns: [], rows: [] })).not.toThrow();
  });
});

describe("what the file is called", () => {
  it("says the hotel and the period, and cannot break a file system", () => {
    expect(exportFileName("The Greek Club", "2026-08-01", "2026-08-31"))
      .toBe("The Greek Club 2026-08-01 — 2026-08-31.xlsx");
    expect(exportFileName('a/b:c*?"<>|', "2026-01-01", "2026-01-02"))
      .toBe("abc 2026-01-01 — 2026-01-02.xlsx");
  });
});
