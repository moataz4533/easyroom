"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

// Temporary compatibility dictionary for feature screens while their text is
// progressively moved to namespaced next-intl messages. Exact phrases win;
// the ordered phrase list also handles counters and interpolated values.
export const LEGACY_EN = {
  "التقارير": "Reports",
  "الإعدادات": "Settings",
  "الحجوزات": "Bookings",
  "النظافة": "Housekeeping",
  "حجز جديد": "New booking",
  "حجز مباشر": "Direct booking",
  "غرفة قياسية": "Standard room",
  "شركات": "Corporate",
  "وصول متأخر، سرير زيادة…": "Late arrival, extra bed…",
  "الغرف": "Rooms",
  "وصول اليوم": "Arrivals today",
  "خروج اليوم": "Departures today",
  "تحتاج تنظيف": "Needs cleaning",
  "مشغولة": "Occupied",
  "شاغرة": "Available",
  "معطلة": "Out of service",
  "نظيفة": "Clean",
  "تمت مراجعتها": "Inspected",
  "كل الغرف جاهزة.": "All rooms are ready.",
  "باقي الغرف": "Other rooms",
  "المدير بس": "Managers only",
  "خلصت": "Done",
  "حالة الغرف": "Room status",
  "اضغط على غرفة لعرض تفاصيلها واتخاذ إجراء.": "Select a room to view details and actions.",
  "تحديث": "Refresh",
  "اتصل": "Call",
  "واتساب": "WhatsApp",
  "تسكين": "Check in",
  "تسجيل خروج": "Check out",
  "تم التسكين": "Guest checked in",
  "تمديد الإقامة": "Extend stay",
  "تحقق": "Check availability",
  "تأكيد التمديد": "Confirm extension",
  "الغرفة شاغرة حتى هذا التاريخ.": "The room is available through this date.",
  "نقل إلى غرفة أخرى": "Move to another room",
  "نقل النزيل": "Move guest",
  "النقل يبدأ من": "Move starting on",
  "عرض الغرف المتاحة": "Show available rooms",
  "السبب (اختياري)": "Reason (optional)",
  "انقل هنا": "Move here",
  "إلغاء": "Cancel",
  "تعطيل الغرفة": "Take room out of service",
  "إرجاع الغرفة للخدمة": "Return room to service",
  "من": "From",
  "لحد": "To",
  "السبب": "Reason",
  "تأكيد التعطيل": "Confirm outage",
  "احجز الغرفة دي": "Book this room",
  "جارٍ التحميل…": "Loading…",
  "جارٍ الحساب…": "Calculating…",
  "لا توجد بيانات.": "No data.",
  "آخر ٧ أيام": "Last 7 days",
  "آخر شهر": "Last month",
  "الشهر الحالي": "This month",
  "آخر ٣ شهور": "Last 3 months",
  "مدة محددة": "Custom range",
  "نسبة الإشغال": "Occupancy",
  "إيراد الغرف": "Room revenue",
  "متوسط سعر الليلة": "Average daily rate",
  "إيراد الغرفة المتاحة": "Revenue per available room",
  "حجوزات": "Bookings",
  "ليالي ضيوف": "Guest nights",
  "محصّل": "Collected",
  "متبقي": "Outstanding",
  "للليلة المباعة": "Per sold room-night",
  "مقياس الأداء الحقيقي": "Core performance measure",
  "الإشغال يوم بيوم": "Daily occupancy",
  "رسم بياني للإشغال اليومي": "Daily occupancy chart",
  "الإيراد محسوب بالليلة — الإقامة الممتدة على شهرين تُقسَّم بينهما.": "Revenue is calculated per night, so stays spanning two months are split correctly.",
  "المحصّل حسب طريقة الدفع": "Collected by payment method",
  "لمطابقة الكاش آخر الوردية.": "For end-of-shift cash reconciliation.",
  "الحجوزات جت منين": "Booking sources",
  "فلوس متبقية": "Outstanding balances",
  "سجل الإلغاءات": "Cancellation log",
  "مين ألغى إيه وامتى وليه.": "Who cancelled what, when and why.",
  "كاش": "Cash",
  "إنستاباي": "Instapay",
  "فودافون كاش": "Vodafone Cash",
  "فيزا": "Card",
  "تحويل بنكي": "Bank transfer",
  "مكالمة": "Phone",
  "حضور مباشر": "Walk-in",
  "الموقع": "Website",
  "مواقع حجز": "OTA",
  "توصية": "Referral",
  "أخرى": "Other",
  "لم يحضر": "No-show",
  "ملغي": "Cancelled",
  "ابدأ برقم الهاتف — إذا سبق للنزيل الإقامة ستظهر بياناته تلقائياً.": "Start with the phone number. Returning guests will appear automatically.",
  "رقم الهاتف": "Phone number",
  "بحث": "Search",
  "اسم النزيل": "Guest name",
  "نزيل جديد": "New guest",
  "الدخول": "Check-in",
  "الخروج": "Check-out",
  "تاريخ المغادرة يجب أن يكون بعد الوصول": "Check-out must be after check-in",
  "الغرف الشاغرة": "Available rooms",
  "اضغط على غرفة لاختيارها، وحدد عدد الأفراد بها.": "Select a room and set its occupancy.",
  "لا توجد غرف شاغرة في هذه التواريخ.": "No rooms are available for these dates.",
  "جهة الحجز": "Rate plan",
  "الشركة (اختياري)": "Company (optional)",
  "— بدون —": "— None —",
  "مصدر الحجز": "Booking source",
  "ملاحظات": "Notes",
  "تأكيد الحجز": "Confirm booking",
  "جارٍ التسجيل…": "Saving…",
  "السعر صفر — التركيبة دي لسه مالهاش سعر في الإعدادات.": "This combination has no price in Settings yet.",
  "الحجوزات الحالية": "Current bookings",
  "كل الحجوزات": "All bookings",
  "ابحث بالاسم أو رقم الهاتف أو رقم الحجز": "Search by guest, phone or booking reference",
  "الكل": "All",
  "مؤكد": "Confirmed",
  "مقيم": "Checked in",
  "غادر": "Checked out",
  "إلغاء الحجز": "Cancel booking",
  "عدم حضور": "No-show",
  "مغادرة مبكرة": "Early check-out",
  "المدفوعات": "Payments",
  "إضافة دفعة": "Add payment",
  "استرداد": "Refund",
  "طريقة الدفع": "Payment method",
  "المبلغ": "Amount",
  "تسجيل الدفعة": "Record payment",
  "الإجمالي": "Total",
  "المدفوع": "Paid",
  "الباقي": "Balance",
  "الأسعار": "Rates",
  "الموظفين": "Staff",
  "بيانات الفندق": "Property details",
  "حفظ الأسعار": "Save rates",
  "عدد الأفراد": "Occupancy",
  "أنواع الغرف": "Room types",
  "أقصى عدد": "Maximum occupancy",
  "الاسم": "Name",
  "الاسم بالإنجليزية": "English name",
  "الكود": "Code",
  "إضافة نوع": "Add room type",
  "رقم غرفة جديدة": "New room number",
  "النوع": "Type",
  "إضافة": "Add",
  "إضافة موظف": "Add staff member",
  "المالك": "Owner",
  "مدير": "Manager",
  "استقبال": "Reception",
  "نظافة": "Housekeeping",
  "موقوف": "Suspended",
  "تغيير كلمة المرور": "Change password",
  "إيقاف الحساب": "Suspend account",
  "تفعيل الحساب": "Activate account",
  "حفظ البيانات": "Save details",
  "اسم الفندق": "Hotel name",
  "اسم الفندق بالإنجليزية": "Hotel name in English",
  "رقم الواتساب": "WhatsApp number",
  "رابط الشعار": "Logo URL",
  "اللون الأساسي": "Primary colour",
  "كلمة مرور المدير": "Manager password",
  "جارٍ التنفيذ…": "Working…",
  "رجوع": "Back",
  "إغلاق": "Close",
  "حفظ": "Save",
  "إضافة موظف جديد": "Add staff member",
  "الإيميل": "Email address",
  "اسم المستخدم": "Username",
  "اسم المستخدم (يُستخدم لتسجيل الدخول)": "Username (used to sign in)",
  "3 أحرف إنجليزية أو أرقام على الأقل، دون مسافات. مثال: ahmed أو reception1": "At least 3 English letters or numbers, with no spaces. Example: ahmed or reception1",
  "يسجّل الموظف الدخول باسم المستخدم وكلمة المرور فقط، دون بريد إلكتروني. سلّمه الاثنين بنفسك.": "Staff sign in using only their username and password. Give them both directly.",
  "كلمة المرور": "Password",
  "تأكيد كلمة المرور": "Confirm password",
  "تأكيد كلمة المرور الجديدة": "Confirm new password",
  "أعد إدخال كلمة المرور": "Enter the same password again",
  "الصلاحية": "Role",
  "حفظ الموظف": "Save staff member",
  "تغيير الأسعار": "Change rates"
};

const REPLACEMENTS = [
  ["جنيه", "EGP"], [" ج", " EGP"], ["ليلة", "night"], ["ليالي", "nights"],
  ["غرفة", "room"], ["غرف", "rooms"], ["أفراد", "guests"], ["فرد", "guest"],
  ["حجز", "booking"], ["عملية", "transaction"], ["بواسطة", "by"],
  ["آخر تحديث:", "Last updated:"], ["هذه بيانات محفوظة، وليست لحظية.", "This is saved data, not live data."],
  ["إجراء مستني الإرسال.", "action waiting to be sent."], ["إجراء بانتظار الإرسال.", "action waiting to be sent."],
  ["غرفة تحتاج إجراءً.", "room needs attention."], ["الحساب", "account"],
  ["فلوس متبقية", "Outstanding balances"], ["بالليلة", "per night"],
  ["السعر", "rate"], ["تاريخ", "date"], ["جديد", "new"], ["اليوم", "today"]
];

export function translateLegacyText(value) {
  if (!value || !/[\u0600-\u06FF]/.test(value)) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const core = value.trim();
  if (LEGACY_EN[core]) return `${leading}${LEGACY_EN[core]}${trailing}`;
  let out = core;
  for (const [ar, en] of REPLACEMENTS) out = out.split(ar).join(en);
  return `${leading}${out}${trailing}`;
}

function translateTree(root) {
  if (!root || typeof NodeFilter === "undefined") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (["SCRIPT", "STYLE"].includes(node.parentElement?.tagName)) continue;
    const translated = translateLegacyText(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  const elements = root.querySelectorAll?.("[placeholder], [title], [aria-label]") || [];
  for (const el of elements) {
    for (const attr of ["placeholder", "title", "aria-label"]) {
      if (!el.hasAttribute(attr)) continue;
      const current = el.getAttribute(attr);
      const translated = translateLegacyText(current);
      if (translated !== current) el.setAttribute(attr, translated);
    }
  }
}

export default function LegacyTranslator() {
  const locale = useLocale();

  useEffect(() => {
    if (locale !== "en") return;
    translateTree(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          const translated = translateLegacyText(record.target.nodeValue);
          if (translated !== record.target.nodeValue) record.target.nodeValue = translated;
        } else {
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              const translated = translateLegacyText(node.nodeValue);
              if (translated !== node.nodeValue) node.nodeValue = translated;
            }
            else if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
