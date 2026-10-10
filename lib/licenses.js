/**
 * Hotel licences, the part that decides things.
 *
 * The database is the authority — a hotel past its end date and its grace
 * period is locked by the isolation gates whatever any screen says. What is
 * here mirrors those rules so a screen can say what is about to happen
 * before the button is pressed ("this renewal runs to 12 March"), and so the
 * hotel's own app knows when to warn. If the two ever disagree, the
 * database is right and this file is the bug; the tests below pin the
 * mirror to the same cases the replay suite pins the database to.
 */

export const LICENSE_KINDS = ["trial", "paid", "unlimited"];
export const LICENSE_STATES = ["active", "expiring", "grace", "expired", "unlimited"];
export const EXTEND_MONTHS = [1, 3, 6, 12];
export const PAY_METHODS = ["cash", "instapay", "vodafone_cash", "transfer", "other"];
export const OPENING_CHOICES = ["trial", "paid", "unlimited"];

/** Same window as license_state() in the database. */
export const WARNING_DAYS = 14;
export const DEFAULT_GRACE = 7;
export const DEFAULT_TRIAL_DAYS = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parts(iso) {
  if (!ISO.test(String(iso || ""))) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCMonth() !== m - 1) return null;
  return { y, m, d };
}

function iso(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(day, days) {
  const p = parts(day);
  if (!p) return null;
  const at = new Date(Date.UTC(p.y, p.m - 1, p.d + Number(days || 0)));
  return at.toISOString().slice(0, 10);
}

/**
 * Months added the way Postgres adds them: 31 January plus one month is 28
 * (or 29) February, not 3 March. The renewal preview has to land on the
 * same day the database will write.
 */
export function addMonths(day, months) {
  const p = parts(day);
  if (!p) return null;
  const total = p.y * 12 + (p.m - 1) + Number(months || 0);
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return iso(y, m, Math.min(p.d, last));
}

export function daysBetween(from, to) {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/** One word for where a licence stands. Mirrors license_state(). */
export function licenseState(endsOn, grace, today) {
  if (!endsOn) return "unlimited";
  const left = daysBetween(today, endsOn);
  if (left === null) return "unlimited";
  if (left < -Number(grace || 0)) return "expired";
  if (left < 0) return "grace";
  if (left <= WARNING_DAYS) return "expiring";
  return "active";
}

/**
 * Where N paid months start from. Mirrors platform_extend_license():
 * from the current end while it is running or in grace (paying early never
 * loses a day; grace is a courtesy, not free days), from today once it has
 * locked or when it was open-ended.
 */
export function renewalBase({ ends_on, grace_days, today }) {
  if (!ends_on) return today;
  if (licenseState(ends_on, grace_days, today) === "expired") return today;
  return ends_on;
}

export function renewalEnd(license, months) {
  return addMonths(renewalBase(license), months);
}

export function extendProblem({ months, amount }) {
  const n = Number(months);
  if (!Number.isInteger(n) || n < 1 || n > 60) return "months";
  if (amount !== "" && amount !== null && amount !== undefined) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "amount";
    if (value < 0) return "negativeAmount";
  }
  return null;
}

export function setLicenseProblem({ kind, endsOn, grace }) {
  if (!LICENSE_KINDS.includes(kind)) return "kind";
  if (kind !== "unlimited" && !parts(endsOn)) return "endsOn";
  if (grace !== "" && grace !== null && grace !== undefined) {
    const n = Number(grace);
    if (!Number.isInteger(n) || n < 0 || n > 60) return "grace";
  }
  return null;
}

/** The pill colour for a state, the same in the panel and in the hotel. */
export function licenseTone(state) {
  if (state === "expired" || state === "grace") return "bad";
  if (state === "expiring") return "warn";
  return "ok";
}

/** The licence line across the top of the panel. */
export function licenseTotals(licenses) {
  const rows = licenses || [];
  const count = (state) => rows.filter((row) => row.state === state).length;
  return {
    expiring: count("expiring"),
    grace: count("grace"),
    expired: count("expired"),
    trials: rows.filter((row) => row.kind === "trial").length,
    paidThisYear: rows.reduce((sum, row) => sum + (Number(row.paid_this_year) || 0), 0),
    paidTotal: rows.reduce((sum, row) => sum + (Number(row.paid_total) || 0), 0),
  };
}

/**
 * Whether the hotel's own app should say anything, and to whom.
 *
 * In the warning window only the people who can pay hear about it —
 * reception being told the hotel's subscription is ending is noise to them
 * and a worry to the guest at the desk. In grace everybody is told, because
 * in a week nobody will be able to sign in, and the person at the desk is
 * the one who will find out first.
 */
export function licenseNotice(license, role) {
  if (!license) return null;
  if (license.state === "grace") return "grace";
  if (license.state === "expiring" && (role === "owner" || role === "manager")) return "expiring";
  return null;
}

/**
 * Why an account with memberships sees no hotel. A locked hotel is
 * invisible through every other door, so without this its staff would be
 * told their account belongs to no hotel at all — which is false, and sends
 * them to the wrong person.
 */
export function lockReason(licenses) {
  const rows = licenses || [];
  if (rows.some((row) => row.hotel_active && row.state === "expired")) return "expired";
  if (rows.some((row) => !row.hotel_active)) return "suspended";
  return null;
}

/**
 * The licence a new hotel opens on, as the database calls that set it.
 *
 * Paid months are a "set to today" followed by an extension rather than one
 * set to a computed date, so the opening payment is written down with its
 * amount like every renewal after it, and so the months start today rather
 * than after the implicit trial.
 */
export function openingCalls(choice, today) {
  const { mode, trialDays, months, amount, currency, method, note } = choice || {};
  if (mode === "unlimited") {
    return [{ fn: "platform_set_license", args: { p_kind: "unlimited", p_note: note || null } }];
  }
  if (mode === "paid") {
    return [
      { fn: "platform_set_license", args: { p_kind: "paid", p_ends_on: today, p_note: note || null } },
      {
        fn: "platform_extend_license",
        args: {
          p_months: Number(months),
          p_amount: amount === "" || amount === null || amount === undefined ? null : Number(amount),
          p_currency: currency || "EGP",
          p_method: method || null,
          p_note: note || null,
        },
      },
    ];
  }
  const days = Number(trialDays) || DEFAULT_TRIAL_DAYS;
  return [{
    fn: "platform_set_license",
    args: { p_kind: "trial", p_ends_on: addDays(today, days), p_note: note || null },
  }];
}

export function openingProblem(choice) {
  const { mode, trialDays, months, amount } = choice || {};
  if (!OPENING_CHOICES.includes(mode)) return "kind";
  if (mode === "trial") {
    const n = Number(trialDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) return "trialDays";
  }
  if (mode === "paid") return extendProblem({ months, amount });
  return null;
}

/**
 * Whether the panel offers to remind the hotel, and with which message.
 * Only once there is something to say: in the warning window, in grace,
 * and after it has locked. A hotel that is fine is not messaged.
 */
export function reminderKey(state) {
  return ["expiring", "grace", "expired"].includes(state) ? `remind_${state}` : null;
}
