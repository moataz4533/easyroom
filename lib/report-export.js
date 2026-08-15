/**
 * The revenue report as a sheet an accountant can work with.
 *
 * One row per night, because that is how the hotel earns and how every
 * number in this system is already counted. Room revenue and extras stay in
 * separate columns and are never added into the rate figures — ADR and
 * RevPAR are per room-night by definition, and folding an airport transfer
 * into them would quietly overstate both.
 *
 * A totals row at the bottom, so nobody has to trust that the sheet and the
 * screen agree: they can see it add up.
 */

import { STYLE, buildWorkbook } from "./xlsx";

const HEADERS = {
  ar: {
    day: "التاريخ", weekday: "اليوم", sold: "غرف مُباعة", available: "غرف متاحة",
    occupancy: "الإشغال %", rooms: "إيراد الغرف", adr: "متوسط سعر الليلة",
    revpar: "إيراد الغرفة المتاحة", total: "الإجمالي",
    totalsRow: "الإجمالي", title: "تقرير المبيعات والإيرادات",
    subtitle: "{hotel} · من {from} إلى {to}",
    extras: "إيراد الإضافات",
  },
  en: {
    day: "Date", weekday: "Day", sold: "Rooms sold", available: "Rooms available",
    occupancy: "Occupancy %", rooms: "Room revenue", adr: "ADR",
    revpar: "RevPAR", total: "Total",
    totalsRow: "Total", title: "Sales and revenue report",
    subtitle: "{hotel} · {from} to {to}",
    extras: "Extras revenue",
  },
};

const WEEKDAYS = {
  ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function weekdayName(iso, locale = "ar") {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return (WEEKDAYS[locale] || WEEKDAYS.ar)[new Date(ms).getUTCDay()];
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `daily` is what report_daily returns; `summary` is report_summary's single
 * row. Rooms available per day comes from the summary rather than being
 * assumed, so a hotel that took a room out of service still adds up.
 */
export function buildRevenueRows(daily, roomsPerDay) {
  return (daily || []).map((row) => {
    const sold = num(row.rooms_sold);
    const revenue = num(row.revenue);
    const available = roomsPerDay || 0;
    return {
      day: row.day,
      sold,
      available,
      occupancy: num(row.occupancy_pct),
      revenue,
      // Per room actually sold, and per room available. Zero rooms sold has
      // no average rate — reporting zero would drag a month's ADR down.
      adr: sold > 0 ? revenue / sold : null,
      revpar: available > 0 ? revenue / available : null,
    };
  });
}

export function totalsOf(rows) {
  const sold = rows.reduce((sum, r) => sum + r.sold, 0);
  const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const available = rows.reduce((sum, r) => sum + r.available, 0);
  return {
    sold,
    available,
    revenue,
    occupancy: available > 0 ? (100 * sold) / available : 0,
    adr: sold > 0 ? revenue / sold : null,
    revpar: available > 0 ? revenue / available : null,
  };
}

/** A file name that sorts by date and says which hotel it came from. */
export function exportFileName(hotel, from, to) {
  const clean = String(hotel || "hotel").trim().replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
  return `${clean} ${from} — ${to}.xlsx`;
}

export function buildRevenueWorkbook({
  hotel, from, to, daily, summary, locale = "ar",
}) {
  const t = HEADERS[locale] || HEADERS.ar;
  const roomsPerDay = (daily || []).length > 0
    ? Math.round(num(summary?.nights_available) / daily.length)
    : 0;

  const rows = buildRevenueRows(daily, roomsPerDay);
  const totals = totalsOf(rows);

  const body = rows.map((row) => ([
    { date: row.day, style: STYLE.date },
    { text: weekdayName(row.day, locale) },
    { number: row.sold },
    { number: row.available },
    { number: Number(row.occupancy.toFixed(1)) },
    { number: Number(row.revenue.toFixed(2)), style: STYLE.money },
    row.adr === null ? "" : { number: Number(row.adr.toFixed(2)), style: STYLE.money },
    row.revpar === null ? "" : { number: Number(row.revpar.toFixed(2)), style: STYLE.money },
  ]));

  body.push([
    { text: t.totalsRow, style: STYLE.total },
    "",
    { number: totals.sold, style: STYLE.total },
    { number: totals.available, style: STYLE.total },
    { number: Number(totals.occupancy.toFixed(1)), style: STYLE.total },
    { number: Number(totals.revenue.toFixed(2)), style: STYLE.money },
    totals.adr === null ? "" : { number: Number(totals.adr.toFixed(2)), style: STYLE.money },
    totals.revpar === null ? "" : { number: Number(totals.revpar.toFixed(2)), style: STYLE.money },
  ]);

  // Extras are reported beside room revenue, never inside it.
  const extras = num(summary?.extras_revenue);
  if (extras > 0) {
    body.push([]);
    body.push([
      { text: t.extras, style: STYLE.total }, "", "", "", "",
      { number: Number(extras.toFixed(2)), style: STYLE.money },
    ]);
  }

  return buildWorkbook({
    name: locale === "en" ? "Revenue" : "الإيرادات",
    rtl: locale !== "en",
    title: `${t.title} — ${t.subtitle.replace("{hotel}", hotel || "").replace("{from}", from).replace("{to}", to)}`,
    columns: [
      { header: t.day, width: 14 },
      { header: t.weekday, width: 12 },
      { header: t.sold, width: 12 },
      { header: t.available, width: 12 },
      { header: t.occupancy, width: 12 },
      { header: t.rooms, width: 18 },
      { header: t.adr, width: 18 },
      { header: t.revpar, width: 20 },
    ],
    rows: body,
  });
}
