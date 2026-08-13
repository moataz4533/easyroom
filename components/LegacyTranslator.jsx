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
  "النضافة": "Housekeeping",
  "حجز جديد": "New booking",
  "حجز مباشر": "Direct booking",
  "غرفة قياسية": "Standard room",
  "شركات": "Corporate",
  "وصول متأخر، سرير زيادة…": "Late arrival, extra bed…",
  "الغرف": "Rooms",
  "وصول النهاردة": "Arrivals today",
  "خروج النهاردة": "Departures today",
  "محتاجة نضافة": "Needs cleaning",
  "مشغولة": "Occupied",
  "فاضية": "Available",
  "معطلة": "Out of service",
  "نضيفة": "Clean",
  "اتراجعت": "Inspected",
  "كل الغرف مظبوطة.": "All rooms are ready.",
  "باقي الغرف": "Other rooms",
  "المدير بس": "Managers only",
  "خلصت": "Done",
  "حالة الغرف": "Room status",
  "اضغط على غرفة تشوف تفاصيلها وتعمل إجراء.": "Select a room to view details and actions.",
  "تحديث": "Refresh",
  "اتصل": "Call",
  "واتساب": "WhatsApp",
  "تسكين": "Check in",
  "تسجيل خروج": "Check out",
  "تم التسكين": "Guest checked in",
  "تمديد الإقامة": "Extend stay",
  "اتأكد": "Check availability",
  "أكّد التمديد": "Confirm extension",
  "الغرفة فاضية لحد التاريخ ده.": "The room is available through this date.",
  "نقل لغرفة تانية": "Move to another room",
  "نقل النزيل": "Move guest",
  "النقل يبدأ من": "Move starting on",
  "شوف الغرف المتاحة": "Show available rooms",
  "السبب (اختياري)": "Reason (optional)",
  "انقل هنا": "Move here",
  "إلغاء": "Cancel",
  "تعطيل الغرفة": "Take room out of service",
  "إرجاع الغرفة للخدمة": "Return room to service",
  "من": "From",
  "لحد": "To",
  "السبب": "Reason",
  "أكّد التعطيل": "Confirm outage",
  "احجز الغرفة دي": "Book this room",
  "بيحمّل…": "Loading…",
  "بيحسب…": "Calculating…",
  "مفيش بيانات.": "No data.",
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
  "الإيراد محسوب بالليلة — الإقامة اللي على شهرين بتتقسم على الاتنين.": "Revenue is calculated per night, so stays spanning two months are split correctly.",
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
  "حضر بنفسه": "Walk-in",
  "الموقع": "Website",
  "مواقع حجز": "OTA",
  "توصية": "Referral",
  "غير كده": "Other",
  "لم يحضر": "No-show",
  "ملغي": "Cancelled",
  "حجز جديد": "New booking",
  "ابدأ برقم الموبايل — لو النزيل جه قبل كده هيظهر لوحده.": "Start with the phone number. Returning guests will appear automatically.",
  "رقم الموبايل": "Phone number",
  "دور": "Search",
  "اسم النزيل": "Guest name",
  "نزيل جديد": "New guest",
  "الدخول": "Check-in",
  "الخروج": "Check-out",
  "الخروج لازم يكون بعد الدخول": "Check-out must be after check-in",
  "الغرف الفاضية": "Available rooms",
  "اضغط غرفة تختارها، وحدد عدد الأفراد فيها.": "Select a room and set its occupancy.",
  "مفيش غرف فاضية في التواريخ دي.": "No rooms are available for these dates.",
  "جهة الحجز": "Rate plan",
  "الشركة (اختياري)": "Company (optional)",
  "— بدون —": "— None —",
  "الحجز جه منين": "Booking source",
  "ملاحظات": "Notes",
  "أكّد الحجز": "Confirm booking",
  "بيسجل…": "Saving…",
  "السعر صفر — التركيبة دي لسه مالهاش سعر في الإعدادات.": "This combination has no price in Settings yet.",
  "الحجوزات الحالية": "Current bookings",
  "كل الحجوزات": "All bookings",
  "ابحث بالاسم أو رقم الموبايل أو رقم الحجز": "Search by guest, phone or booking reference",
  "الكل": "All",
  "مؤكد": "Confirmed",
  "مقيم": "Checked in",
  "غادر": "Checked out",
  "إلغاء الحجز": "Cancel booking",
  "عدم حضور": "No-show",
  "خروج بدري": "Early check-out",
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
  "الباسورد": "Manager password",
  "بيانات النادي": "Property details",
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
  "ريسبشن": "Reception",
  "هاوس كيبينج": "Housekeeping",
  "موقوف": "Suspended",
  "غيّر الباسورد": "Change password",
  "إيقاف الحساب": "Suspend account",
  "تفعيل الحساب": "Activate account",
  "حفظ البيانات": "Save details",
  "اسم الفندق": "Hotel name",
  "اسم الفندق بالإنجليزية": "Hotel name in English",
  "رقم الواتساب": "WhatsApp number",
  "رابط اللوجو": "Logo URL",
  "اللون الأساسي": "Primary colour",
  "باسورد المدير": "Manager password",
  "بيتنفذ…": "Working…",
  "رجوع": "Back",
  "إغلاق": "Close",
  "حفظ": "Save",
  "إضافة موظف جديد": "Add staff member",
  "الإيميل": "Email address",
  "اسم المستخدم": "Username",
  "اسم المستخدم (ده اللي هيدخل بيه)": "Username (used to sign in)",
  "3 حروف إنجليزية أو أرقام على الأقل، من غير مسافات. مثال: ahmed أو reception1": "At least 3 English letters or numbers, with no spaces. Example: ahmed or reception1",
  "الموظف هيدخل باسم المستخدم والباسورد فقط، من غير إيميل. سلّمه الاتنين بنفسك.": "Staff sign in using only their username and password. Give them both directly.",
  "كلمة المرور": "Password",
  "تأكيد الباسورد": "Confirm password",
  "تأكيد الباسورد الجديد": "Confirm new password",
  "اكتب نفس الباسورد تاني": "Enter the same password again",
  "الصلاحية": "Role",
  "حفظ الموظف": "Save staff member",
  "تغيير الأسعار": "Change rates"
};

const REPLACEMENTS = [
  ["جنيه", "EGP"], [" ج", " EGP"], ["ليلة", "night"], ["ليالي", "nights"],
  ["غرفة", "room"], ["غرف", "rooms"], ["أفراد", "guests"], ["فرد", "guest"],
  ["حجز", "booking"], ["عملية", "transaction"], ["بواسطة", "by"],
  ["آخر تحديث:", "Last updated:"], ["البيانات دي محفوظة، مش لحظية.", "This is saved data, not live data."],
  ["إجراء مستني الإرسال.", "action waiting to be sent."], ["إجراء بانتظار الإرسال.", "action waiting to be sent."],
  ["غرفة محتاجة شغل.", "room needs attention."], ["الحساب", "account"],
  ["فلوس متبقية", "Outstanding balances"], ["بالليلة", "per night"],
  ["السعر", "rate"], ["تاريخ", "date"], ["جديد", "new"], ["النهاردة", "today"]
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
