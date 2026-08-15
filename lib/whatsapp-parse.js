/**
 * Turning a WhatsApp message into the start of a booking.
 *
 * Almost every booking this hotel takes arrives as a message, and reception
 * retypes it into the form by hand. The message already says the dates, how
 * many people, and often the name — so this reads what it can and fills the
 * form in, leaving reception to check it rather than transcribe it.
 *
 * Written as plain code rather than a model, deliberately. It runs offline,
 * costs nothing, and gives the same answer twice — and because reception
 * reads the draft before confirming it, the accuracy this cannot reach is
 * covered by the person who can see the conversation. Every field it is not
 * certain about says so, and a field it cannot find it leaves empty rather
 * than inventing.
 *
 * The tests are the specification: they are written as the messages this
 * hotel actually receives.
 */

import { shiftDate } from "./format";

/* ------------------------------------------------------------------ text */

const ARABIC_INDIC = /[٠-٩۰-۹]/g;
const DIGIT_BASE = { "٠": 0x0660, "۰": 0x06f0 };

/** ٢٠٢٦ and 2026 are the same number and have to compare as one. */
export function toWesternDigits(text) {
  return String(text || "").replace(ARABIC_INDIC, (d) => {
    const base = d >= "۰" && d <= "۹" ? DIGIT_BASE["۰"] : DIGIT_BASE["٠"];
    return String(d.codePointAt(0) - base);
  });
}

/**
 * People type أ, إ, ا and آ interchangeably, and ة for ه. Folding them is
 * what makes "اغسطس" and "أغسطس" the same month.
 */
export function fold(text) {
  return toWesternDigits(text)
    .replace(/[ً-ْـ]/g, "")     // harakat and tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/[٫٬،]/g, " ")
    .toLowerCase();
}

/** Arabic has no \b, so a word is what is not surrounded by more letters. */
const EDGE = "(?<![\\p{L}\\p{N}])";
const EDGE_END = "(?![\\p{L}\\p{N}])";
const word = (body, flags = "u") => new RegExp(`${EDGE}(?:${body})${EDGE_END}`, flags);
const wordG = (body) => word(body, "gu");

/* ---------------------------------------------------------------- months */

const MONTHS = [
  ["يناير|جانفي|january|jan"],
  ["فبراير|فيفري|february|feb"],
  ["مارس|march|mar"],
  ["ابريل|افريل|april|apr"],
  ["مايو|ماي|may"],
  ["يونيو|يونيه|جوان|june|jun"],
  ["يوليو|يوليه|جويليه|july|jul"],
  ["اغسطس|غشت|اوت|august|aug"],
  ["سبتمبر|شتنبر|september|sept|sep"],
  ["اكتوبر|october|oct"],
  ["نوفمبر|november|nov"],
  ["ديسمبر|دجنبر|december|dec"],
];

const MONTH_ALTERNATION = MONTHS.map(([alts]) => alts).join("|");

function monthNumber(name) {
  const folded = fold(name);
  const index = MONTHS.findIndex(([alts]) => alts.split("|").includes(folded));
  return index === -1 ? null : index + 1;
}

/* -------------------------------------------------------------- weekdays */

// Sunday first, to line up with Date#getUTCDay.
const WEEKDAYS = [
  "الاحد|احد|sunday|sun",
  "الاتنين|الاثنين|اتنين|اثنين|monday|mon",
  "الثلاثاء|التلات|تلات|ثلاثاء|tuesday|tue|tues",
  "الاربعاء|اربعاء|اربع|wednesday|wed",
  "الخميس|خميس|thursday|thu|thurs",
  "الجمعه|جمعه|friday|fri",
  "السبت|سبت|saturday|sat",
];

const WEEKDAY_ALTERNATION = WEEKDAYS.join("|");

/* --------------------------------------------------------------- numbers */

/** Spelled-out counts, which is how most messages write small numbers. */
const SPELLED = {
  1: "واحده|واحد|one|a",
  2: "اتنين|تنين|اثنين|two",
  3: "تلاته|ثلاثه|تلات|ثلاث|three",
  4: "اربعه|اربع|four",
  5: "خمسه|خمس|five",
  6: "سته|ست|six",
  7: "سبعه|سبع|seven",
  8: "تمانيه|ثمانيه|تمان|eight",
  9: "تسعه|تسع|nine",
  10: "عشره|عشر|ten",
};

const SPELLED_ALTERNATION = Object.values(SPELLED).join("|");

function spelledNumber(text) {
  const folded = fold(text);
  for (const [value, alts] of Object.entries(SPELLED)) {
    if (alts.split("|").includes(folded)) return Number(value);
  }
  return null;
}

/** A count written either way: "3" or "تلاته". */
const COUNT = `(\\d{1,3}|${SPELLED_ALTERNATION})`;

function countValue(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  return spelledNumber(raw);
}

/* ----------------------------------------------------------------- dates */

const ISO = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function validDay(year, month, day) {
  if (!month || !day || day < 1 || day > 31 || month < 1 || month > 12) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * A guest writing "20 August" in September means next August, not one that
 * has gone. Anything up to a month behind today is read as this year — a
 * message about a stay that started yesterday is a real thing.
 */
function resolveYear(today, month, day) {
  const year = Number(today.slice(0, 4));
  for (const candidate of [year, year + 1]) {
    if (!validDay(candidate, month, day)) continue;
    const iso = ISO(candidate, month, day);
    if (iso >= shiftDate(today, -31)) return iso;
  }
  return validDay(year + 1, month, day) ? ISO(year + 1, month, day) : null;
}

/**
 * Every date the message mentions, in the order it mentions them.
 *
 * A bare day number ("من 20 لـ 23 أغسطس") carries no month of its own, so it
 * is kept as a day and given the month of the next dated mention afterwards.
 * That is the single most common shape a booking message takes here.
 */
export function findDates(text, today) {
  const source = fold(text);
  const found = [];

  // Every reading claims the characters it read, so a later, looser rule
  // cannot read the same characters again: the "9" inside "12/9" is not a
  // day of its own, and the "بكره" inside "بعد بكره" is not tomorrow.
  const push = (at, end, entry) => found.push({ at, end, ...entry });
  const taken = (from, to) => found.some((f) => from < f.end && f.at < to);
  const whole = (m) => [m.index, m.index + m[0].length];

  // 5/8, 5-8-2026, 05.08 — day first, which is how it is written here.
  for (const m of source.matchAll(/(?<![\d/.-])(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?![\d/.-])/g)) {
    const [, d, mo, y] = m;
    const day = Number(d);
    const month = Number(mo);
    if (!month || month > 12) continue;
    const year = y ? Number(y.length === 2 ? `20${y}` : y) : null;
    const iso = year && validDay(year, month, day) ? ISO(year, month, day) : resolveYear(today, month, day);
    if (iso) push(...whole(m), { iso, sure: true });
  }

  // 5 أغسطس / أغسطس 5 / 5th August
  const dayMonth = new RegExp(
    `(?:(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?${EDGE}(${MONTH_ALTERNATION})${EDGE_END}` +
    `|${EDGE}(${MONTH_ALTERNATION})${EDGE_END}\\s*(\\d{1,2})(?:st|nd|rd|th)?)`, "gu");
  for (const m of source.matchAll(dayMonth)) {
    if (taken(...whole(m))) continue;
    const day = Number(m[1] ?? m[4]);
    const month = monthNumber(m[2] ?? m[3]);
    const iso = month && resolveYear(today, month, day);
    if (iso) push(...whole(m), { iso, sure: true });
  }

  // A month on its own still pins the bare days around it.
  for (const m of source.matchAll(wordG(MONTH_ALTERNATION))) {
    if (taken(...whole(m))) continue;
    push(...whole(m), { month: monthNumber(m[0]), sure: true });
  }

  // النهاردة، بكرة، بعد بكرة
  for (const m of source.matchAll(wordG("النهارده|النهارد|اليوم|today"))) {
    if (taken(...whole(m))) continue;
    push(...whole(m), { iso: today, sure: true });
  }
  for (const m of source.matchAll(wordG("بعد بكره|بعد غد|day after tomorrow"))) {
    if (taken(...whole(m))) continue;
    push(...whole(m), { iso: shiftDate(today, 2), sure: true });
  }
  for (const m of source.matchAll(wordG("بكره|غدا|tomorrow"))) {
    if (taken(...whole(m))) continue;
    push(...whole(m), { iso: shiftDate(today, 1), sure: true });
  }

  // الخميس الجاي / next Thursday / يوم الجمعة
  const weekday = new RegExp(
    `(?:(?:next|يوم)\\s*)?${EDGE}(${WEEKDAY_ALTERNATION})${EDGE_END}(?:\\s*(?:الجاي|القادم|الجايه|القادمه))?`, "gu");
  for (const m of source.matchAll(weekday)) {
    if (taken(...whole(m))) continue;
    const index = WEEKDAYS.findIndex((alts) => alts.split("|").includes(m[1]));
    if (index === -1) continue;
    const from = new Date(`${today}T00:00:00Z`).getUTCDay();
    // Naming the day it already is means the one a week from now.
    const ahead = (index - from + 7) % 7 || 7;
    // A weekday is the softest evidence in a message; it is a guess.
    push(...whole(m), { iso: shiftDate(today, ahead), sure: false });
  }

  // Bare day numbers, only where a range says they are days: "من 20 لـ 23".
  // Each end is claimed on its own, because the other end is very often
  // already read as a full date — "من 20 لـ 23 أغسطس" is one bare day and
  // one dated one, not two of either.
  const range = new RegExp(
    `${EDGE}(?:من|from)?\\s*(\\d{1,2})\\s*(?:الي|الى|لحد|حتي|حتى|لغايه|ل|لـ|to|till|until|[-–—])\\s*(\\d{1,2})${EDGE_END}`, "gdu");
  for (const m of source.matchAll(range)) {
    for (const span of [m.indices[1], m.indices[2]]) {
      if (!span || taken(...span)) continue;
      push(span[0], span[1], { day: Number(source.slice(...span)), sure: true });
    }
  }

  found.sort((a, b) => a.at - b.at);

  // Give the bare days the month standing next to them, then drop what is
  // still only a month — a month with no day is not a date.
  const monthNear = (at) => {
    const withMonth = found.filter((f) => f.iso || f.month);
    const after = withMonth.find((f) => f.at >= at);
    const before = [...withMonth].reverse().find((f) => f.at < at);
    const pick = after || before;
    if (!pick) return null;
    return pick.month || Number(pick.iso.slice(5, 7));
  };

  return found
    .map((entry) => {
      if (entry.iso) return entry;
      if (entry.day == null) return null;
      const month = monthNear(entry.at);
      if (!month) return null;
      const iso = resolveYear(today, month, entry.day);
      return iso ? { at: entry.at, iso, sure: entry.sure } : null;
    })
    .filter(Boolean)
    .filter((entry, index, all) => all.findIndex((other) => other.iso === entry.iso) === index);
}

/* ---------------------------------------------------------------- counts */

const said = (value, sure) => (value == null ? null : { value, sure });

export function findNights(text) {
  const source = fold(text);
  if (word("ليلتين|ليلتان|two nights").test(source)) return said(2, true);
  if (word("اسبوع|اسبوعا|a week|one week").test(source)) return said(7, true);
  if (word("اسبوعين|two weeks").test(source)) return said(14, true);
  const m = source.match(new RegExp(`${COUNT}\\s*(?:ليالي|ليله|نايت|nights?)`, "u"));
  if (m) return said(countValue(m[1]), true);
  if (word("ليله|ليلة|one night").test(source)) return said(1, true);
  return null;
}

/**
 * The definite article is written joined on — "الغرفة", "الأفراد" — so a
 * word that only matches bare misses most of the messages that use it.
 */
const THE = "(?:ال)?";

export function findPax(text) {
  const source = fold(text);
  if (word(`${THE}(?:شخصين|فردين|نفرين)|اتنين افراد|two people|two adults`).test(source)) return said(2, true);
  const m = source.match(new RegExp(`${COUNT}\\s*${THE}(?:افراد|اشخاص|نفر|بالغين|كبار|people|persons?|adults?|pax|guests?)`, "u"));
  if (m) return said(countValue(m[1]), true);
  if (word("شخص واحد|فرد واحد|لوحدي|بمفردي|one person|single person|solo").test(source)) return said(1, true);
  return null;
}

export function findRooms(text) {
  const source = fold(text);
  if (word(`${THE}(?:غرفتين|اوضتين|روومين)|two rooms`).test(source)) return said(2, true);
  const m = source.match(new RegExp(`${COUNT}\\s*${THE}(?:غرف|اوض|رووم|rooms?)`, "u"));
  if (m) return said(countValue(m[1]), true);
  if (word(`${THE}(?:غرفه|اوضه|رووم)|a room|one room|single room|double room`).test(source)) return said(1, true);
  return null;
}

/* ----------------------------------------------------------- who is this */

/**
 * A phone number, if the message spells one out. Kept in the digits the
 * sender wrote it in rather than reformatted, so reception recognises it.
 */
export function findPhone(text) {
  const source = toWesternDigits(text).replace(/[()‏‎]/g, "");
  const m = source.match(/(?<![\d])(\+?\d[\d\s-]{7,17}\d)(?![\d])/);
  if (!m) return null;
  const digits = m[1].replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 8) return null;
  return said(digits, true);
}

const NAME_LEADS = "الاسم|اسمي|باسم|بإسم|الحجز باسم|my name is|name is|name|this is";

/**
 * Only a name the message announces. Guessing a name out of a greeting is
 * how a booking ends up filed under "السلام عليكم", so it is not attempted:
 * an empty box reception fills in beats a wrong name it has to notice.
 */
export function findName(text) {
  for (const line of String(text || "").split(/[\n،,.]/)) {
    const m = line.match(new RegExp(`(?:${NAME_LEADS})\\s*[:：-]?\\s*(.{2,40})$`, "iu"));
    if (!m) continue;
    const name = m[1].trim().replace(/^[/:\-–—\s]+/, "").trim();
    // A "name" that is mostly digits is a phone number on the same line.
    if (!name || /^\+?[\d\s-]+$/.test(toWesternDigits(name))) continue;
    return said(name, true);
  }
  return null;
}

/* ----------------------------------------------------------------- draft */

/**
 * The whole message read at once.
 *
 * Nothing here is a decision — it is a filled-in form waiting to be checked.
 * `sure: false` marks what reception should look at first.
 */
export function parseMessage(text, { today } = {}) {
  const on = today || new Date().toISOString().slice(0, 10);
  const dates = findDates(text, on);
  const nights = findNights(text);

  let checkIn = dates[0] ? said(dates[0].iso, dates[0].sure) : null;
  let checkOut = dates[1] ? said(dates[1].iso, dates[1].sure) : null;

  // Two dates the wrong way round is a typo, not a stay running backwards.
  if (checkIn && checkOut && checkOut.value <= checkIn.value) {
    if (dates.length === 2 && checkOut.value < checkIn.value) {
      [checkIn, checkOut] = [checkOut, checkIn];
    } else {
      checkOut = null;
    }
  }

  // A start and a length is the other common shape: "من الخميس، 3 ليالي".
  if (checkIn && !checkOut && nights) {
    checkOut = said(shiftDate(checkIn.value, nights.value), checkIn.sure && nights.sure);
  }

  return {
    name: findName(text),
    phone: findPhone(text),
    checkIn,
    checkOut,
    nights: nights || (checkIn && checkOut
      ? said(Math.round((Date.parse(`${checkOut.value}T00:00:00Z`) - Date.parse(`${checkIn.value}T00:00:00Z`)) / 86400000),
        checkIn.sure && checkOut.sure)
      : null),
    pax: findPax(text),
    rooms: findRooms(text),
  };
}

export const DRAFT_FIELDS = ["name", "phone", "checkIn", "checkOut", "pax", "rooms"];

/** What the screen should mark for a second look, in reading order. */
export function uncertainFields(draft) {
  return DRAFT_FIELDS.filter((field) => draft?.[field] && draft[field].sure === false);
}

export function foundFields(draft) {
  return DRAFT_FIELDS.filter((field) => draft?.[field]);
}

/** Whether there is enough here to be worth showing at all. */
export function isWorthReviewing(draft) {
  return Boolean(draft?.checkIn || draft?.phone || (draft?.nights && draft?.pax));
}
