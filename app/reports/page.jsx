"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, addDays, dayLabel } from "../../lib/supabase";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import { FileSpreadsheet } from "lucide-react";
import { buildRevenueWorkbook, exportFileName } from "../../lib/report-export";
import { localizedName } from "../../lib/locale";

export default function Page() {
  return (
    <Shell>
      <Reports />
    </Shell>
  );
}

// Ranges a hotel owner actually asks for, rather than arbitrary spans.
const RANGES = ["7", "30", "month", "90", "custom"];

const METHODS = ["cash", "instapay", "vodafone_cash", "card", "transfer"];

const SOURCES = ["whatsapp", "phone", "walk_in", "website", "ota", "referral", "other"];

function rangeDates(key) {
  const t = today();
  if (key === "month") {
    const d = new Date(t + "T00:00:00");
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    return [first.toISOString().slice(0, 10), addDays(t, 1)];
  }
  return [addDays(t, -Number(key)), addDays(t, 1)];
}

function Reports() {
  const { property } = useProperty();
  const locale = useLocale();
  const [range, setRange] = useState("30");
  const [[from, to], setDates] = useState(rangeDates("30"));
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [sources, setSources] = useState([]);
  const [owing, setOwing] = useState([]);
  const [cancels, setCancels] = useState([]);
  const [methods, setMethods] = useState([]);
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const tx = useTranslations("Export");
  const t = useTranslations("Reports");
  const common = useTranslations("Common");
  const [toast, showToast] = useToast();

  // Every figure on this screen is money in the same currency, written the
  // same way. Once, here.
  const money = (value) => `${egp(value, locale)} ${common("currency")}`;

  useEffect(() => {
    if (range !== "custom") setDates(rangeDates(range));
  }, [range]);

  const load = useCallback(async () => {
    if (!property || !from || !to || to <= from) return;
    setLoading(true);

    const args = { p_property: property.id, p_from: from, p_to: to };
    const [s, d, src, out, can, pay, ext] = await Promise.all([
      supabase.rpc("report_summary", args),
      supabase.rpc("report_daily", args),
      supabase.rpc("report_by_source", args),
      supabase.rpc("report_outstanding", { p_property: property.id }),
      supabase.rpc("report_cancellations", args),
      supabase.rpc("report_payments", args),
      supabase.rpc("report_extras", args),
    ]);

    if (s.error) showToast(s.error.message, true);

    setSummary(s.data?.[0] || null);
    setDaily(d.data || []);
    setSources(src.data || []);
    setOwing(out.data || []);
    setCancels(can.data || []);
    setMethods(pay.data || []);
    setExtras(ext.data || []);
    setLoading(false);
  }, [property, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  /**
   * The period on screen, as a sheet. Built on the device from what is
   * already loaded — nothing goes back to the server, so it works on the
   * same bad connection everything else here is built for.
   */
  function downloadExcel() {
    const bytes = buildRevenueWorkbook({
      hotel: localizedName(property, locale),
      from, to, daily, summary, locale,
    });
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(localizedName(property, locale), from, to);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Freed on the next tick: revoking before the click is handled cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const empty = summary && Number(summary.nights_sold) === 0;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>{t("title")}</h2>
      <p className="section-note">{t("note")}</p>

      <div className="report-controls">
        <div className="tabs" role="tablist">
          {RANGES.map((key) => (
            <button key={key} className="tab" role="tab" aria-selected={range === key}
              onClick={() => setRange(key)}>
              {t(`range_${key}`)}
            </button>
          ))}
        </div>
        <button className="btn" onClick={downloadExcel}
          disabled={loading || !summary || (daily || []).length === 0}>
          <FileSpreadsheet size={16} />{tx("excel")}
        </button>
      </div>

      {range === "custom" && (
        <div className="card row" style={{ marginBottom: 14 }}>
          <div className="field grow">
            <label>{t("from")}</label>
            <input type="date" className="mono" value={from}
              onChange={(e) => setDates([e.target.value, to])} />
          </div>
          <div className="field grow">
            <label>{t("to")}</label>
            <input type="date" className="mono" value={to}
              onChange={(e) => setDates([from, e.target.value])} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty">{t("calculating")}</div>
      ) : !summary ? (
        <div className="empty">{t("noData")}</div>
      ) : (
        <>
          {empty && (
            <div className="banner warn">
              {t("noNights")}
            </div>
          )}

          <section className="section">
            <div className="kpis">
              <Kpi label={t("occupancy")} value={`${summary.occupancy_pct}%`} big
                sub={t("nightsSold", { sold: summary.nights_sold, available: summary.nights_available })} />
              <Kpi label={t("roomRevenue")} value={money(summary.room_revenue)} big />
              {/* Beside room revenue, never inside ADR or RevPAR: those are
                  per room-night, and a transfer to the airport is not. */}
              <Kpi label={t("extrasRevenue")} value={money(summary.extras_revenue)}
                sub={t("totalRevenue", { amount: egp(summary.total_revenue, locale), currency: common("currency") })} />
              <Kpi label={t("adr")} value={money(summary.adr)} sub={t("adrNote")} />
              <Kpi label={t("revpar")} value={money(summary.revpar)} sub={t("revparNote")} />
              <Kpi label={t("bookingsMade")} value={summary.bookings_made} />
              <Kpi label={t("guestNights")} value={summary.guests_hosted} />
              <Kpi label={t("collected")} value={money(summary.collected)} tone="ok" />
              <Kpi label={t("outstanding")} value={money(summary.outstanding)}
                tone={Number(summary.outstanding) > 0 ? "warn" : null} />
            </div>
          </section>

          {(Number(summary.cancellations) > 0 || Number(summary.no_shows) > 0) && (
            <div className="banner warn">
              {t("lost", { cancellations: summary.cancellations, noShows: summary.no_shows })}
            </div>
          )}

          <DailyChart rows={daily} t={t} />

          {extras.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("extrasSold")}</h2>
              <p className="section-note">{t("extrasSoldNote")}</p>
              <div className="stack">
                {extras.map((row) => (
                  <div key={row.description} className="card spread" style={{ padding: "9px 12px" }}>
                    <span style={{ fontSize: 13 }}>{row.description}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>×{egp(row.quantity, locale)}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{money(row.total)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {methods.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("byMethod")}</h2>
              <p className="section-note">{t("byMethodNote")}</p>
              <div className="stack">
                {methods.map((m) => (
                  <div key={m.method} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>
                        {METHODS.includes(m.method) ? t(`method_${m.method}`) : m.method}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {t("transactionCount", { count: m.count })}
                      </div>
                    </div>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {money(m.total)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {sources.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("whereFrom")}</h2>
              <div className="stack">
                {sources.map((s) => (
                  <div key={s.source} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>
                        {SOURCES.includes(s.source) ? t(`source_${s.source}`) : s.source}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {t("sourceLine", { bookings: s.bookings, nights: s.nights })}
                      </div>
                    </div>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {money(s.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {owing.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>
                {t("owing", { count: owing.length })}
              </h2>
              <div className="stack">
                {owing.map((o) => (
                  <div key={o.booking_id} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{o.guest_name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        <span className="code">{o.reference}</span>{" "}
                        {dayLabel(o.check_in, locale)} ← {dayLabel(o.check_out, locale)}
                      </div>
                    </div>
                    <div style={{ textAlign: "end" }}>
                      <div className="mono" style={{ fontWeight: 600, color: "var(--sand)" }}>
                        {money(o.owed)}
                      </div>
                      {o.guest_phone && (
                        <a className="btn sm" style={{ marginTop: 4 }}
                          href={`tel:${o.guest_phone}`}>{t("call")}</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cancels.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("cancellations")}</h2>
              <p className="section-note">{t("cancellationsNote")}</p>
              <div className="stack">
                {cancels.map((c, i) => (
                  <div key={i} className="card">
                    <div className="spread">
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{c.guest_name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          <span className="code">{c.reference}</span>{" "}
                          {c.status === "no_show" ? t("noShow") : t("cancelled")}
                          {" · "}{t("by", { name: c.cancelled_by })}
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: 13 }}>{money(c.amount)}</span>
                    </div>
                    {c.reason && (
                      <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
                        {t("reason", { reason: c.reason })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, big, tone }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value mono ${big ? "big" : ""}`}
        style={tone === "ok" ? { color: "var(--ok)" }
          : tone === "warn" ? { color: "var(--sand)" } : undefined}>
        {value}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Plain SVG rather than a charting library: one chart doesn't justify
// shipping 50kB to a phone on Dahab wifi.
function DailyChart({ rows, t }) {
  if (!rows.length) return null;

  const max = Math.max(...rows.map((r) => Number(r.rooms_sold)), 1);
  const w = Math.max(rows.length * 26, 280);
  const h = 130;
  const pad = 18;

  return (
    <section className="section">
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>{t("dailyOccupancy")}</h2>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
          role="img" aria-label={t("chartLabel")}>
          <line x1="0" y1={h - pad} x2={w} y2={h - pad}
            stroke="var(--line)" strokeWidth="1" />
          {rows.map((r, i) => {
            const val = Number(r.rooms_sold);
            const bh = Math.max((val / max) * (h - pad * 2), val > 0 ? 3 : 0);
            const x = i * 26 + 6;
            return (
              <g key={r.day}>
                <title>{t("chartBar", { day: r.day, rooms: val, percent: r.occupancy_pct })}</title>
                <rect x={x} y={h - pad - bh} width="14" height={bh} rx="3"
                  fill={val >= max * 0.8 ? "var(--sea)" : "var(--sand)"} />
                {(i === 0 || i === rows.length - 1 || i % 7 === 0) && (
                  <text x={x + 7} y={h - 5} textAnchor="middle"
                    fontSize="9" fill="var(--muted)">
                    {r.day.slice(8)}/{r.day.slice(5, 7)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
