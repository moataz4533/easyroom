/**
 * The platform panel's pure half.
 *
 * Everything that decides something — whether a branch code is usable, what
 * a hotel's numbers add up to, whether an account has ever been signed into
 * — is here, so it can be tested without a database and cannot disagree
 * with itself between two screens.
 */

/**
 * A branch code is not cosmetic. It becomes part of every staff login
 * address for that hotel — `{code}.{username}@staff.easyroom.app` — so it
 * has to survive being written into an email local part, and it can never
 * change afterwards without locking every staff member out.
 */
export const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

const RESERVED = ["www", "app", "api", "admin", "staff", "mail", "root", "support", "test"];

export function normaliseCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A guess at the code, from the hotel's name. Always the human's to accept. */
export function suggestCode(name) {
  return normaliseCode(name).slice(0, 40).replace(/-$/, "");
}

/**
 * Only length, reservation and collision are checked here, because
 * normaliseCode has already made the shape correct — it strips everything
 * CODE_PATTERN would reject. A "bad characters" branch would be unreachable,
 * and the test below holds normalise to that promise.
 */
export function codeProblem(value, taken = []) {
  const code = normaliseCode(value);
  if (!code) return "empty";
  if (code.length < 3) return "short";
  if (code.length > 40) return "long";
  if (RESERVED.includes(code)) return "reserved";
  if (taken.map(normaliseCode).includes(code)) return "taken";
  return null;
}

/* ------------------------------------------------------------- accounts */

export const PLATFORM_ROLES = ["owner", "manager", "reception", "housekeeping"];

/** The members of one hotel, owners first, then by name. */
export function membersOf(members, propertyId) {
  const order = Object.fromEntries(PLATFORM_ROLES.map((role, index) => [role, index]));
  return (members || [])
    .filter((member) => member.property_id === propertyId)
    .sort((a, b) => {
      const byRole = (order[a.role] ?? 9) - (order[b.role] ?? 9);
      if (byRole !== 0) return byRole;
      return String(a.full_name || "").localeCompare(String(b.full_name || ""));
    });
}

/**
 * An account created but never used. Worth seeing on the panel: it usually
 * means the password never reached the person it was made for.
 */
export function neverSignedIn(member) {
  return !member?.last_sign_in_at;
}

export function isDormant(member, today, days = 30) {
  if (!member?.last_sign_in_at) return false;
  const last = new Date(member.last_sign_in_at);
  const at = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(last.getTime()) || Number.isNaN(at.getTime())) return false;
  return (at - last) / 86400000 > days;
}

/** One hotel, summarised the way the panel lists it. */
export function summariseProperty(property, members) {
  const own = membersOf(members, property.id);
  return {
    id: property.id,
    slug: property.slug,
    name: property.name,
    active: property.is_active !== false,
    createdAt: property.created_at,
    rooms: property.counts?.rooms || 0,
    bookings: property.counts?.bookings || 0,
    guests: property.counts?.guests || 0,
    payments: property.counts?.payments || 0,
    members: own.length,
    activeMembers: own.filter((member) => member.is_active).length,
    neverUsed: own.filter(neverSignedIn).length,
    owner: own.find((member) => member.role === "owner") || null,
  };
}

/** The whole platform in one line, which is what the top of the panel is. */
export function platformTotals(properties, members) {
  const rows = (properties || []).map((property) => summariseProperty(property, members));
  return {
    hotels: rows.length,
    liveHotels: rows.filter((row) => row.active).length,
    accounts: (members || []).length,
    activeAccounts: (members || []).filter((member) => member.is_active).length,
    neverUsed: (members || []).filter(neverSignedIn).length,
    rooms: rows.reduce((sum, row) => sum + row.rooms, 0),
    bookings: rows.reduce((sum, row) => sum + row.bookings, 0),
  };
}

/**
 * The address a hotel's staff will sign in with, shown while the code is
 * being typed — because the code cannot be changed later, and this is the
 * one moment its consequence is visible.
 */
export function staffAddressExample(code, username = "ahmed") {
  const clean = normaliseCode(code);
  return clean ? `${clean}.${username}@staff.easyroom.app` : "";
}

/** Enough to open a hotel, checked before anything is sent. */
export function newHotelProblems({ name, code, ownerName, ownerEmail, password, again }, taken = []) {
  const problems = [];
  if (!String(name || "").trim()) problems.push("name");
  const code_ = codeProblem(code, taken);
  if (code_) problems.push(`code:${code_}`);
  if (!String(ownerName || "").trim()) problems.push("ownerName");
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(String(ownerEmail || "").trim())) problems.push("ownerEmail");
  if (String(password || "").length < 8) problems.push("password");
  else if (password !== again) problems.push("mismatch");
  return problems;
}
