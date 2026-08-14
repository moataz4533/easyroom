"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ListChecks, RefreshCw, Search } from "lucide-react";
import { useLocale } from "next-intl";
import Shell, { Toast, useProperty, useToast } from "../../components/Shell";
import { supabase } from "../../lib/supabase";

const ACTIONS = {
  ar: {
    created: "تم إنشاء الحجز", checked_in: "تم تسكين النزيل", checked_out: "تم تسجيل خروج النزيل",
    housekeeping_status_changed: "تغيرت حالة النظافة", received: "تم تسجيل دفعة", refunded: "تم تسجيل استرداد",
    extended: "تم تمديد الإقامة", shortened: "تم تقصير الإقامة", room_moved: "تم نقل الغرفة",
    cancelled: "تم إلغاء الحجز", no_show: "تم تسجيل عدم حضور", room_blocked: "تم تعطيل الغرفة",
    room_unblocked: "تمت إعادة الغرفة للخدمة", pin_changed: "تم تغيير كلمة مرور المدير", updated: "تم تحديث البيانات",
  },
  en: {
    created: "Booking created", checked_in: "Guest checked in", checked_out: "Guest checked out",
    housekeeping_status_changed: "Housekeeping status changed", received: "Payment recorded", refunded: "Refund recorded",
    extended: "Stay extended", shortened: "Stay shortened", room_moved: "Room moved", cancelled: "Booking cancelled",
    no_show: "No-show recorded", room_blocked: "Room taken out of service", room_unblocked: "Room returned to service",
    pin_changed: "Manager password changed", updated: "Details updated",
  },
};

const STATUS = {
  ar: { clean: "نظيفة", dirty: "تحتاج تنظيف", inspected: "تم فحصها", out_of_order: "خارج الخدمة" },
  en: { clean: "Clean", dirty: "Needs cleaning", inspected: "Inspected", out_of_order: "Out of service" },
};

export default function Page() { return <Shell><ActivityLog /></Shell>; }

function ActivityLog() {
  const { property, role } = useProperty();
  const locale = useLocale();
  const isEn = locale === "en";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("list_activity_timeline", { p_property: property.id, p_limit: 300 });
    if (error) showToast(error.message, true); else setRows(data || []);
    setLoading(false);
  }, [property]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return rows.filter((row) => {
      if (type !== "all" && groupOf(row.action) !== type) return false;
      if (!needle) return true;
      return [row.actor_name, row.reference, row.guest_name, ...(row.room_numbers || []), actionLabel(row.action, locale)]
        .filter(Boolean).join(" ").toLocaleLowerCase(locale).includes(needle);
    });
  }, [rows, query, type, locale]);

  if (!["owner", "manager"].includes(role)) {
    return <div className="card access-card"><div className="empty-icon"><ListChecks size={23} /></div><h2>{isEn ? "Manager access required" : "السجل للمدير والمالك فقط"}</h2><p>{isEn ? "Operational history contains staff and financial details." : "سجل العمليات يحتوي على تفاصيل الموظفين والمدفوعات."}</p></div>;
  }

  return <>
    <Toast {...(toast || {})} />
    <div className="page-header">
      <div><h1>{isEn ? "Activity log" : "سجل العمليات"}</h1><p>{isEn ? "A complete, time-ordered record of hotel operations." : "كل عمليات الفندق بالترتيب، والموظف الذي نفّذها."}</p></div>
      <button className="btn" onClick={load} disabled={loading}><RefreshCw size={17} className={loading ? "spin" : ""} />{isEn ? "Refresh" : "تحديث"}</button>
    </div>
    <div className="activity-tools card">
      <label className="activity-search"><Search size={18} aria-hidden="true" /><span className="sr-only">{isEn ? "Search the activity log" : "بحث في سجل العمليات"}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isEn ? "Search by guest, employee, booking or room" : "ابحث بالنزيل أو الموظف أو الحجز أو الغرفة"} /></label>
      <select value={type} onChange={(event) => setType(event.target.value)} aria-label={isEn ? "Operation type" : "نوع العملية"}>
        <option value="all">{isEn ? "All operations" : "كل العمليات"}</option><option value="booking">{isEn ? "Bookings and stays" : "الحجوزات والإقامة"}</option><option value="housekeeping">{isEn ? "Housekeeping" : "النظافة والغرف"}</option><option value="money">{isEn ? "Payments" : "المدفوعات"}</option><option value="admin">{isEn ? "Administration" : "الإدارة"}</option>
      </select>
    </div>
    {loading ? <div className="empty">{isEn ? "Loading activity…" : "جارٍ تحميل السجل…"}</div> : filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><ListChecks size={23} /></div><p>{isEn ? "No matching operations." : "لا توجد عمليات مطابقة."}</p></div> : <div className="timeline" aria-live="polite">{filtered.map((row, index) => <ActivityRow key={row.id} row={row} locale={locale} showDay={index === 0 || dayKey(filtered[index - 1].created_at) !== dayKey(row.created_at)} />)}</div>}
  </>;
}

function ActivityRow({ row, locale, showDay }) {
  const isEn = locale === "en"; const date = new Date(row.created_at);
  const details = [row.reference && `${isEn ? "Booking" : "حجز"} ${row.reference}`, row.guest_name,
    row.room_numbers?.length && `${isEn ? "Room" : "غرفة"} ${row.room_numbers.join("، ")}`,
    row.action === "housekeeping_status_changed" && STATUS[locale]?.[row.payload?.status],
    ["received", "refunded"].includes(row.action) && row.payload?.amount != null ? `${Math.abs(Number(row.payload.amount)).toLocaleString(isEn ? "en-GB" : "ar-EG")} EGP` : null].filter(Boolean);
  return <>{showDay && <div className="timeline-day"><CalendarClock size={15} />{date.toLocaleDateString(isEn ? "en-GB" : "ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" })}</div>}<article className="timeline-row"><div className={`timeline-dot ${groupOf(row.action)}`} aria-hidden="true" /><div className="timeline-card card"><div className="spread"><div className="grow"><strong>{actionLabel(row.action, locale)}</strong><div className="timeline-details">{details.join(" · ")}</div></div><time className="mono" dateTime={row.created_at}>{date.toLocaleTimeString(isEn ? "en-GB" : "ar-EG", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}</time></div><div className="timeline-actor">{isEn ? "By" : "بواسطة"} {row.actor_name || "—"}</div></div></article></>;
}

function actionLabel(action, locale) { return ACTIONS[locale]?.[action] || (locale === "en" ? action.replaceAll("_", " ") : action); }
function groupOf(action) { if (["received", "refunded"].includes(action)) return "money"; if (action.includes("housekeeping") || action.includes("room_")) return "housekeeping"; if (["pin_changed", "updated"].includes(action)) return "admin"; return "booking"; }
function dayKey(value) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
