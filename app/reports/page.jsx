"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import { supabase, egp, today, addDays, dayLabel } from "../../lib/supabase";

export default function Page() {
  return (
    <Shell>
      <Reports />
    </Shell>
  );
}

// Ranges a hotel owner actually asks for, rather than arbitrary spans.
const RANGES = [
  ["7", "آخر ٧ أيام"],
  ["30", "آخر شهر"],
  ["month", "الشهر الحالي"],
  ["90", "آخر ٣ شهور"],
  ["custom", "مدة محددة"],
];

const SOURCE_LABEL = {
  whatsapp: "واتساب", phone: "مكالمة", walk_in: "حضر بنفسه",
  website: "الموقع", ota: "مواقع حجز", referral: "توصية", other: "غير كده",
};

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
  const [range, setRange] = useState("30");
  const [[from, to], setDates] = useState(rangeDates("30"));
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [sources, setSources] = useState([]);
  const [owing, setOwing] = useState([]);
  const [cancels, setCancels] = useState([]);
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, showToast] = useToast();

  useEffect(() => {
    if (range !== "custom") setDates(rangeDates(range));
  }, [range]);

  const load = useCallback(async () => {
    if (!property || !from || !to || to <= from) return;
    setLoading(true);

    const args = { p_property: property.id, p_from: from, p_to: to };
    const [s, d, src, out, can, pay] = await Promise.all([
      supabase.rpc("report_summary", args),
      supabase.rpc("report_daily", args),
      supabase.rpc("report_by_source", args),
      supabase.rpc("report_outstanding", { p_property: property.id }),
      supabase.rpc("report_cancellations", args),
      supabase.rpc("report_payments", args),
    ]);

    if (s.error) showToast(s.error.message, true);

    setSummary(s.data?.[0] || null);
    setDaily(d.data || []);
    setSources(src.data || []);
    setOwing(out.data || []);
    setCancels(can.data || []);
    setMethods(pay.data || []);
    setLoading(false);
  }, [property, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const empty = summary && Number(summary.nights_sold) === 0;

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 4 }}>التقارير</h2>
      <p className="section-note">
        الإيراد محسوب بالليلة — الإقامة اللي على شهرين بتتقسم على الاتنين.
      </p>

      <div className="tabs">
        {RANGES.map(([k, label]) => (
          <button key={k} className="tab" aria-selected={range === k}
            onClick={() => setRange(k)}>
            {label}
          </button>
        ))}
      </div>

      {range === "custom" && (
        <div className="card row" style={{ marginBottom: 14 }}>
          <div className="field grow">
            <label>من</label>
            <input type="date" className="mono" value={from}
              onChange={(e) => setDates([e.target.value, to])} />
          </div>
          <div className="field grow">
            <label>لحد</label>
            <input type="date" className="mono" value={to}
              onChange={(e) => setDates([from, e.target.value])} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty">بيحسب…</div>
      ) : !summary ? (
        <div className="empty">مفيش بيانات.</div>
      ) : (
        <>
          {empty && (
            <div className="banner warn">
              مفيش ليالي مباعة في المدة دي. الأرقام كلها أصفار.
            </div>
          )}

          <section className="section">
            <div className="kpis">
              <Kpi label="نسبة الإشغال" value={`${summary.occupancy_pct}%`} big
                sub={`${summary.nights_sold} من ${summary.nights_available} ليلة`} />
              <Kpi label="إيراد الغرف" value={`${egp(summary.room_revenue)} ج`} big />
              <Kpi label="متوسط سعر الليلة" value={`${egp(summary.adr)} ج`}
                sub="للليلة المباعة" />
              <Kpi label="إيراد الغرفة المتاحة" value={`${egp(summary.revpar)} ج`}
                sub="مقياس الأداء الحقيقي" />
              <Kpi label="حجوزات" value={summary.bookings_made} />
              <Kpi label="ليالي ضيوف" value={summary.guests_hosted} />
              <Kpi label="محصّل" value={`${egp(summary.collected)} ج`} tone="ok" />
              <Kpi label="متبقي" value={`${egp(summary.outstanding)} ج`}
                tone={Number(summary.outstanding) > 0 ? "warn" : null} />
            </div>
          </section>

          {(Number(summary.cancellations) > 0 || Number(summary.no_shows) > 0) && (
            <div className="banner warn">
              {summary.cancellations} إلغاء و {summary.no_shows} عدم حضور في المدة دي.
            </div>
          )}

          <DailyChart rows={daily} />

          {methods.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>المحصّل حسب طريقة الدفع</h2>
              <p className="section-note">لمطابقة الكاش آخر الوردية.</p>
              <div className="stack">
                {methods.map((m) => (
                  <div key={m.method} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>
                        {{ cash: "كاش", instapay: "إنستاباي", vodafone_cash: "فودافون كاش",
                           card: "فيزا", transfer: "تحويل بنكي" }[m.method] || m.method}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {m.count} عملية
                      </div>
                    </div>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {egp(m.total)} ج
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {sources.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>الحجوزات جت منين</h2>
              <div className="stack">
                {sources.map((s) => (
                  <div key={s.source} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>
                        {SOURCE_LABEL[s.source] || s.source}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {s.bookings} حجز · {s.nights} غرفة
                      </div>
                    </div>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {egp(s.revenue)} ج
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {owing.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>
                فلوس متبقية ({owing.length})
              </h2>
              <div className="stack">
                {owing.map((o) => (
                  <div key={o.booking_id} className="card spread">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{o.guest_name}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        <span className="code">{o.reference}</span>{" "}
                        {dayLabel(o.check_in)} ← {dayLabel(o.check_out)}
                      </div>
                    </div>
                    <div style={{ textAlign: "end" }}>
                      <div className="mono" style={{ fontWeight: 600, color: "var(--sand)" }}>
                        {egp(o.owed)} ج
                      </div>
                      {o.guest_phone && (
                        <a className="btn sm" style={{ marginTop: 4 }}
                          href={`tel:${o.guest_phone}`}>اتصل</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cancels.length > 0 && (
            <section className="section">
              <h2 style={{ fontSize: 14, marginBottom: 8 }}>سجل الإلغاءات</h2>
              <p className="section-note">مين ألغى إيه وامتى وليه.</p>
              <div className="stack">
                {cancels.map((c, i) => (
                  <div key={i} className="card">
                    <div className="spread">
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{c.guest_name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          <span className="code">{c.reference}</span>{" "}
                          {c.status === "no_show" ? "لم يحضر" : "ملغي"} · بواسطة {c.cancelled_by}
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: 13 }}>{egp(c.amount)} ج</span>
                    </div>
                    {c.reason && (
                      <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>
                        السبب: {c.reason}
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
function DailyChart({ rows }) {
  if (!rows.length) return null;

  const max = Math.max(...rows.map((r) => Number(r.rooms_sold)), 1);
  const w = Math.max(rows.length * 26, 280);
  const h = 130;
  const pad = 18;

  return (
    <section className="section">
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>الإشغال يوم بيوم</h2>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
          role="img" aria-label="رسم بياني للإشغال اليومي">
          <line x1="0" y1={h - pad} x2={w} y2={h - pad}
            stroke="var(--line)" strokeWidth="1" />
          {rows.map((r, i) => {
            const val = Number(r.rooms_sold);
            const bh = Math.max((val / max) * (h - pad * 2), val > 0 ? 3 : 0);
            const x = i * 26 + 6;
            return (
              <g key={r.day}>
                <title>{`${r.day}: ${val} غرفة (${r.occupancy_pct}%)`}</title>
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
